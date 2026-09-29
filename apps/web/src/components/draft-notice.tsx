// Owner decision: the legal pages stay marked as drafts until the spec §16 legal review.
export function DraftNotice() {
  return (
    <p className="draft-notice" role="note">
      <strong>Draft, pending legal review.</strong> This text hasn&apos;t been reviewed by a lawyer yet and
      may change before the app launches.
    </p>
  );
}
