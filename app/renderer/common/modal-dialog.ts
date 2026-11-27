export function showModalWhileAttached(dialog: HTMLDialogElement) {
  dialog.showModal();
  return () => dialog.close();
}
