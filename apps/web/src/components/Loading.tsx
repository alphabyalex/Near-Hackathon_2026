export function LoadError({ message }: { message: string }) {
  return (
    <p className="notice" role="alert">
      Could not load this view: {message} Check that the API is running on port 8787.
    </p>
  );
}

export function Loading() {
  return <p className="loading">Loading...</p>;
}
