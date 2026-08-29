/**
 * Minimal className joiner. Filters falsy values so conditional classes read cleanly:
 *   cn("base", isActive && "active", className)
 *
 * Deliberately not clsx/tailwind-merge — this project doesn't have conflicting-class problems
 * that would justify the dependency.
 */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
