import { useEffect, useLayoutEffect, useRef } from 'react';

const showModalWith = (useTimedEffect: typeof useEffect) => () => {
  const dialog = useRef<HTMLDialogElement>(null);
  useTimedEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => element.close();
  }, []);
  return dialog;
};

export const useModalDialog = showModalWith(useEffect);
export const useModalDialogBeforePaint = showModalWith(useLayoutEffect);
