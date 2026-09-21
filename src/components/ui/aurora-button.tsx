import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const auroraButton = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill text-sm font-semibold transition-all duration-300 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97]",
  {
    variants: {
      variant: {
        glow:
          "text-white bg-[linear-gradient(115deg,var(--color-bubble),var(--color-lilac)_52%,var(--color-sky))] shadow-[0_12px_30px_-14px_var(--color-lilac)] hover:shadow-[0_18px_40px_-14px_var(--color-bubble)] hover:-translate-y-0.5",
        soft: "bg-white/75 text-ink border border-white/80 shadow-[0_10px_24px_-18px_var(--color-lilac)] hover:bg-white hover:-translate-y-0.5",
        outline: "border-2 border-lilac/40 text-lilac hover:bg-lilac/10",
        ghost: "text-muted-foreground hover:bg-lilac/10 hover:text-lilac",
        danger: "bg-destructive/10 text-destructive hover:bg-destructive/20",
      },
      size: {
        sm: "h-8 px-3.5 text-xs",
        md: "h-10 px-5",
        lg: "h-12 px-7 text-[15px]",
        icon: "h-10 w-10",
        iconSm: "h-8 w-8",
      },
    },
    defaultVariants: { variant: "glow", size: "md" },
  },
);

export type AuroraButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof auroraButton>;

export function AuroraButton({ className, variant, size, ...props }: AuroraButtonProps) {
  return <button className={cn(auroraButton({ variant, size }), className)} {...props} />;
}

export function AuroraLink({
  className,
  variant,
  size,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & VariantProps<typeof auroraButton>) {
  return <a className={cn(auroraButton({ variant, size }), className)} {...props} />;
}
