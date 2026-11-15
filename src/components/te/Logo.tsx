import { ThirdEyeMark } from "@/features/landing/site/components/BrandMark";

export function LogoMark({ size = 22, animate = false }: { size?: number; animate?: boolean }) {
  return <ThirdEyeMark size={size} animate={animate} className="text-primary" />;
}

export function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      <span className="wordmark-text font-mono text-[12px] font-medium tracking-[0.32em] text-foreground">THIRD EYE</span>
    </div>
  );
}
