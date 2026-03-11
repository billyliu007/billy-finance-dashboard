import { useLanguage } from '../../contexts/LanguageContext.jsx';

export default function DeleteCashConfirmModal({ open, cash, onClose, onConfirm, isDeleting }) {
  const { t } = useLanguage();
  if (!open) return null;

  const name = cash?.name ?? t('modals.thisEntry');

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label={t('modals.removeCashDebt')}>
      <section className="modalCard">
        <header className="modalHeader">
          <h2>{t('modals.removeCashDebt')}</h2>
          <button type="button" className="modalCloseBtn" onClick={onClose} aria-label={t('modals.close')}>
            ✕
          </button>
        </header>
        <div className="modalBody">
          <p>{t('modals.removeCashConfirm', { name })}</p>
        </div>
        <footer className="modalFooter">
          <button
            type="button"
            className="modalBtn secondary"
            onClick={onClose}
            disabled={isDeleting}
          >
            {t('modals.cancel')}
          </button>
          <button
            type="button"
            className="modalBtn danger"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? t('modals.removing') : t('modals.remove')}
          </button>
        </footer>
      </section>
    </div>
  );
}
