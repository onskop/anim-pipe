"""ORM models.

Core idea: a project is a *graph*. Nodes are canonical keyframe images (stable
character states). Edges are short videos between nodes — either a `loop` (back
to the same node: breathing, scratching) or a `transition` (node A -> node B).

Every generation produces one or more `Asset` candidates carrying full lineage
(prompt, seed, model, parent) so triage and regeneration are reproducible.
"""
from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import JSON, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200))
    scenario: Mapped[str] = mapped_column(Text, default="")  # freeform brief / script
    meta: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[dt.datetime] = mapped_column(default=_now)

    characters: Mapped[list["Character"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    nodes: Mapped[list["Node"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    edges: Mapped[list["Edge"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class Character(Base):
    """Reusable character sheet — the consistency anchor across every node."""

    __tablename__ = "characters"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    name: Mapped[str] = mapped_column(String(200))
    # Canonical appearance prompt fragment injected into every node prompt.
    description: Mapped[str] = mapped_column(Text, default="")
    # Reference image asset ids for IP-Adapter (json list).
    ref_image_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    lora_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    lora_weight: Mapped[float] = mapped_column(Float, default=0.8)
    ip_adapter_weight: Mapped[float] = mapped_column(Float, default=0.6)
    meta: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    project: Mapped[Project] = relationship(back_populates="characters")


class Node(Base):
    __tablename__ = "nodes"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    key: Mapped[str] = mapped_column(String(120))  # stable slug used by the game
    title: Mapped[str] = mapped_column(String(200), default="")
    prompt: Mapped[str] = mapped_column(Text, default="")
    negative_prompt: Mapped[str] = mapped_column(Text, default="")
    character_id: Mapped[str | None] = mapped_column(
        ForeignKey("characters.id"), nullable=True
    )
    # Chosen keyframe image (one of its candidate Assets).
    selected_asset_id: Mapped[str | None] = mapped_column(
        ForeignKey("assets.id"), nullable=True
    )
    x: Mapped[float] = mapped_column(Float, default=0.0)
    y: Mapped[float] = mapped_column(Float, default=0.0)
    params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    project: Mapped[Project] = relationship(back_populates="nodes")
    selected_asset: Mapped["Asset | None"] = relationship(
        foreign_keys=[selected_asset_id]
    )


class Edge(Base):
    __tablename__ = "edges"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    source_node_id: Mapped[str] = mapped_column(ForeignKey("nodes.id"))
    # For loops, target == source.
    target_node_id: Mapped[str] = mapped_column(ForeignKey("nodes.id"))
    kind: Mapped[str] = mapped_column(String(20), default="transition")  # loop|transition
    label: Mapped[str] = mapped_column(String(200), default="")
    prompt: Mapped[str] = mapped_column(Text, default="")
    # Optional motion mask asset (cinemagraph: animate only this region).
    motion_mask_id: Mapped[str | None] = mapped_column(
        ForeignKey("assets.id"), nullable=True
    )
    selected_asset_id: Mapped[str | None] = mapped_column(
        ForeignKey("assets.id"), nullable=True
    )
    params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    project: Mapped[Project] = relationship(back_populates="edges")
    selected_asset: Mapped["Asset | None"] = relationship(
        foreign_keys=[selected_asset_id]
    )


class GenerationJob(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    target_type: Mapped[str] = mapped_column(String(20))  # node|edge|asset
    target_id: Mapped[str] = mapped_column(String(32))
    kind: Mapped[str] = mapped_column(String(30))  # image|video_loop|video_transition|upscale
    provider: Mapped[str] = mapped_column(String(40))
    n: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued|running|done|error
    params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    cost: Mapped[float] = mapped_column(Float, default=0.0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[dt.datetime] = mapped_column(default=_now)
    started_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)
    finished_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)


class Asset(Base):
    """A single generated candidate (image or video) with full lineage."""

    __tablename__ = "assets"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    job_id: Mapped[str | None] = mapped_column(ForeignKey("jobs.id"), nullable=True)
    owner_type: Mapped[str | None] = mapped_column(String(20), nullable=True)  # node|edge
    owner_id: Mapped[str | None] = mapped_column(String(32), nullable=True)

    kind: Mapped[str] = mapped_column(String(20))  # image|video|mask
    role: Mapped[str] = mapped_column(String(30), default="candidate")
    # candidate|accepted|rejected|starred — triage state
    status: Mapped[str] = mapped_column(String(20), default="candidate")

    path: Mapped[str] = mapped_column(String(500))  # relative to assets_dir
    thumb_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sha256: Mapped[str] = mapped_column(String(64), default="")
    mime: Mapped[str] = mapped_column(String(80), default="")
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    frames: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fps: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Reproducibility + regeneration lineage.
    params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    parent_asset_id: Mapped[str | None] = mapped_column(
        ForeignKey("assets.id"), nullable=True
    )
    ai_score: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    cost: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[dt.datetime] = mapped_column(default=_now)
