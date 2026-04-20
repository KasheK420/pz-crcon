export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <div className="app-fx">
        <div className="grain" />
        <div className="scanlines" />
        <div className="vignette" />
      </div>
    </>
  );
}
