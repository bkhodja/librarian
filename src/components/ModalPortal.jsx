import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders a modal at the document root rather than where it is declared.
 *
 * `position: fixed` is resolved against the nearest ancestor that establishes
 * a containing block, and `filter`, `transform`, `backdrop-filter` and
 * `will-change` all do that. The Find Duplicates dialog is declared inside the
 * header, which carries a backdrop blur, so its `fixed inset-0` overlay was
 * sized to the 56px header strip instead of the viewport and the dialog was
 * centred 580px above the top of the screen.
 *
 * Rendering through a portal makes a modal independent of wherever its trigger
 * happens to live, so moving a button cannot push a dialog off-screen again.
 */
function ModalPortal({ children }) {
  const [host, setHost] = useState(null);

  useEffect(() => {
    const el = document.createElement('div');
    el.setAttribute('data-modal-root', '');
    document.body.appendChild(el);
    setHost(el);

    return () => {
      document.body.removeChild(el);
    };
  }, []);

  if (!host) return null;
  return createPortal(children, host);
}

export default ModalPortal;
