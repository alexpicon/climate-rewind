import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { APP_NAME, pageTitle } from "@/lib/brand";

export const metadata: Metadata = { title: pageTitle("Page not found") };

/** Any address that is not a page here: the same look as the landing page, one sentence, one way back. */
export default function NotFound() {
  return (
    <main id="notfound" aria-labelledby="nf-h">
      <p className="eyebrow brand-eyebrow">
        <BrandMark size={22} />
        {APP_NAME}
      </p>
      <h1 id="nf-h">That page isn’t here.</h1>
      <p className="nf-sub">The link may be old or mistyped. The weather record for any US address is one step back.</p>
      <Link className="btn nf-btn" href="/">
        Back to {APP_NAME}
      </Link>
    </main>
  );
}
