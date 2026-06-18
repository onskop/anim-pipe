"""Seed an example project: a small adventure graph with idle loops + transitions.

Run:  python -m app.seed
"""
from __future__ import annotations

from .db import init_db, session_scope
from .models import Character, Edge, Graph, Node, Project


def main() -> None:
    init_db()
    with session_scope() as db:
        p = Project(
            name="Demo: Wandering Hero",
            scenario="A young hero stands at a campfire, breathes, looks around, "
            "then walks toward a glowing cave.",
        )
        db.add(p)
        db.flush()

        graph = Graph(project_id=p.id, name="Main")
        db.add(graph)
        db.flush()

        hero = Character(
            project_id=p.id, name="Hero",
            description="a young adventurer, green cloak, short brown hair, "
            "leather boots, friendly face",
            lora_name=None, lora_weight=0.8,
        )
        db.add(hero)
        db.flush()

        defs = [
            ("idle_campfire", "standing by a campfire at night, warm light"),
            ("look_around", "looking around alert, hand near sword"),
            ("cave_entrance", "standing at a glowing cave entrance"),
        ]
        nodes = {}
        for i, (key, prompt) in enumerate(defs):
            n = Node(project_id=p.id, graph_id=graph.id, key=key,
                     title=key.replace("_", " "), prompt=prompt, character_id=hero.id,
                     x=160 + i * 260, y=200)
            db.add(n)
            db.flush()
            nodes[key] = n

        # Idle loops (back to same node) + transitions between nodes.
        db.add(Edge(project_id=p.id, graph_id=graph.id, source_node_id=nodes["idle_campfire"].id,
                    target_node_id=nodes["idle_campfire"].id, kind="loop",
                    label="breathing", prompt="gentle breathing, fire flicker"))
        db.add(Edge(project_id=p.id, graph_id=graph.id, source_node_id=nodes["idle_campfire"].id,
                    target_node_id=nodes["look_around"].id, kind="transition",
                    label="turn to look", prompt="turns head to look around"))
        db.add(Edge(project_id=p.id, graph_id=graph.id, source_node_id=nodes["look_around"].id,
                    target_node_id=nodes["cave_entrance"].id, kind="transition",
                    label="walk to cave", prompt="walks toward the cave"))
        db.add(Edge(project_id=p.id, graph_id=graph.id, source_node_id=nodes["cave_entrance"].id,
                    target_node_id=nodes["cave_entrance"].id, kind="loop",
                    label="idle scratch", prompt="shifts weight, scratches head"))

        print(f"Seeded project {p.id}: {p.name}")


if __name__ == "__main__":
    main()
