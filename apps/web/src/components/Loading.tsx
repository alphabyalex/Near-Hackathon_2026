export function LoadError({ message }: { message: string }) {
  return (
    <p className="notice" role="alert">
      Could not load this view: {message}
    </p>
  );
}

export function Loading() {
  return <p className="loading">Loading...</p>;
}
