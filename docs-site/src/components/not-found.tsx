import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <h1 className="text-4xl font-bold text-fd-foreground">404</h1>
      <p className="text-fd-muted-foreground">Page not found</p>
      <Link to="/$lang" params={{ lang: "en" }} className="text-fd-primary hover:underline">
        Go home
      </Link>
    </div>
  );
}
