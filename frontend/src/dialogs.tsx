/* In-app dialog + toast layer — replaces native prompt()/confirm()/alert().

   Usage (imperative, promise-based):
     const name = await dialog.prompt({ title: "Project name?" });   // string | null
     if (await dialog.confirm({ title: "Delete?", danger: true })) … // boolean
     dialog.toast("Saved", "success");

   Mount <DialogHost /> once at the app root. */
import { create } from "zustand";
import { useEffect, useRef, useState } from "react";

type PromptOpts = {
  title: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  okText?: string;
};
type ConfirmOpts = {
  title: string;
  message?: string;
  confirmText?: string;
  danger?: boolean;
};
type ToastKind = "info" | "success" | "error";
interface Toast {
  id: number;
  msg: string;
  kind: ToastKind;
}
interface PromptReq extends PromptOpts {
  resolve: (v: string | null) => void;
}
interface ConfirmReq extends ConfirmOpts {
  resolve: (v: boolean) => void;
}

interface DialogState {
  prompt: PromptReq | null;
  confirm: ConfirmReq | null;
  toasts: Toast[];
  _set: (partial: Partial<DialogState>) => void;
  _pushToast: (t: Toast) => void;
  _dismissToast: (id: number) => void;
}

const useDialogStore = create<DialogState>((set) => ({
  prompt: null,
  confirm: null,
  toasts: [],
  _set: (partial) => set(partial),
  _pushToast: (t) => set((s) => ({ toasts: [...s.toasts, t] })),
  _dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

let toastSeq = 1;

export const dialog = {
  prompt(opts: PromptOpts): Promise<string | null> {
    return new Promise((resolve) =>
      useDialogStore.getState()._set({ prompt: { ...opts, resolve } }),
    );
  },
  confirm(opts: ConfirmOpts): Promise<boolean> {
    return new Promise((resolve) =>
      useDialogStore.getState()._set({ confirm: { ...opts, resolve } }),
    );
  },
  toast(msg: string, kind: ToastKind = "info") {
    const id = toastSeq++;
    useDialogStore.getState()._pushToast({ id, msg, kind });
    setTimeout(() => useDialogStore.getState()._dismissToast(id), 3200);
  },
};

function PromptModal({ req, onClose }: { req: PromptReq; onClose: () => void }) {
  const [val, setVal] = useState(req.defaultValue ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const done = (v: string | null) => {
    req.resolve(v);
    onClose();
  };
  return (
    <div className="overlay" onClick={() => done(null)}>
      <div className="modal sm" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>{req.title}</h2>
        {req.label && <label className="muted">{req.label}</label>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            done(val.trim() ? val.trim() : null);
          }}
        >
          <input
            ref={inputRef}
            value={val}
            placeholder={req.placeholder}
            onChange={(e) => setVal(e.target.value)}
            style={{ marginTop: 6 }}
          />
          <div className="dlgButtons">
            <button type="button" onClick={() => done(null)}>
              Cancel
            </button>
            <button type="submit" className="primary">
              {req.okText ?? "OK"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConfirmModal({ req, onClose }: { req: ConfirmReq; onClose: () => void }) {
  const done = (v: boolean) => {
    req.resolve(v);
    onClose();
  };
  return (
    <div className="overlay" onClick={() => done(false)}>
      <div className="modal sm" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>{req.title}</h2>
        {req.message && <p className="muted" style={{ marginTop: 0 }}>{req.message}</p>}
        <div className="dlgButtons">
          <button type="button" onClick={() => done(false)}>
            Cancel
          </button>
          <button
            type="button"
            className={req.danger ? "danger" : "primary"}
            onClick={() => done(true)}
          >
            {req.confirmText ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DialogHost() {
  const { prompt, confirm, toasts, _set, _dismissToast } = useDialogStore();
  return (
    <>
      {prompt && <PromptModal req={prompt} onClose={() => _set({ prompt: null })} />}
      {confirm && <ConfirmModal req={confirm} onClose={() => _set({ confirm: null })} />}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => _dismissToast(t.id)}>
            {t.msg}
          </div>
        ))}
      </div>
    </>
  );
}
