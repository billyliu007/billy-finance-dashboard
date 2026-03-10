export default function DeleteCashConfirmModal({ open, cash, onClose, onConfirm, isDeleting }) {
  if (!open) return null;

  const name = cash?.name ?? 'this entry';

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label="Confirm remove cash">
      <section className="modalCard">
        <header className="modalHeader">
          <h2>Remove cash / debt</h2>
          <button type="button" className="modalCloseBtn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modalBody">
          <p>
            Remove &quot;{name}&quot;? This cannot be undone.
          </p>
        </div>
        <footer className="modalFooter">
          <button
            type="button"
            className="modalBtn secondary"
            onClick={onClose}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="modalBtn danger"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? 'Removing...' : 'Remove'}
          </button>
        </footer>
      </section>
    </div>
  );
}
