"use client";

import { cn } from "@/shared/utils/cn";

const variants = {
  primary: "bg-brand-500 hover:bg-brand-600 text-white shadow-sm disabled:bg-surface-3 disabled:text-text-muted",
  secondary: "bg-surface-2 hover:bg-surface-3 text-text-main border border-border disabled:opacity-50",
  outline: "border border-border text-text-main hover:bg-surface-2 hover:border-brand-500/40",
  ghost: "text-text-muted hover:bg-surface-2 hover:text-text-main",
  danger: "bg-red-500 hover:bg-red-600 text-white shadow-sm disabled:bg-surface-3 disabled:text-text-muted",
  success: "bg-green-600 hover:bg-green-700 text-white shadow-sm disabled:bg-surface-3 disabled:text-text-muted",
};

const sizes = {
  xs: "h-6 px-2.5 text-[11px] rounded-[6px] gap-1.5",
  sm: "h-7 px-2.5 text-xs rounded-[8px] gap-1.5",
  md: "h-9 px-4 text-sm rounded-[10px] gap-2",
  lg: "h-11 px-6 text-sm rounded-[10px] gap-2",
};

const iconSizes = {
  xs: "text-[12px]",
  sm: "text-[13px]",
  md: "text-[16px]",
  lg: "text-[18px]",
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  iconSize,
  iconClassName,
  disabled = false,
  loading = false,
  fullWidth = false,
  className,
  ...props
}) {
  const iconCls = cn(
    "material-symbols-outlined shrink-0",
    iconSize || iconSizes[size] || "text-[16px]",
    iconClassName
  );

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center font-semibold transition-all duration-150 ease-out cursor-pointer",
        "active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className={cn(iconCls, "animate-spin")}>progress_activity</span>
      ) : icon ? (
        <span className={iconCls}>{icon}</span>
      ) : null}
      {children}
      {iconRight && !loading && (
        <span className={iconCls}>{iconRight}</span>
      )}
    </button>
  );
}
