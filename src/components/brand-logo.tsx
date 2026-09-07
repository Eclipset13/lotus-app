import Link from "next/link";

type BrandLogoProps = {
  className?: string;
  href?: string;
};

export function BrandLogo({
  className = "",
  href = "/",
}: BrandLogoProps) {
  return (
    <Link
      href={href}
      aria-label="Lotus — на главную"
      className={`brandLogo ${className}`.trim()}
    >
      <svg
        className="brandLogoMark"
        viewBox="0 0 48 48"
        fill="none"
        aria-hidden="true"
      >
        <path d="M24 31C18.3 26.7 18.2 18.8 24 9c5.8 9.8 5.7 17.7 0 22Z" />
        <path d="M22.8 32.3C15.7 31.8 10.9 26.8 9.2 18.5c8.1.7 13.3 5.2 14.8 12.2" />
        <path d="M25.2 32.3c7.1-.5 11.9-5.5 13.6-13.8-8.1.7-13.3 5.2-14.8 12.2" />
        <path d="M20.6 35.7C13.7 37 8 33.6 5.5 27.3c7.3-1.2 12.8 1.1 16.5 6.6" />
        <path d="M27.4 35.7C34.3 37 40 33.6 42.5 27.3c-7.3-1.2-12.8 1.1-16.5 6.6" />
        <path d="M9 39c8.8 3.8 21.2 3.8 30 0" />
      </svg>

      <span className="brandLogoWordmark">LOTUS</span>
    </Link>
  );
}
