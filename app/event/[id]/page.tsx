import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EventPlayer } from "@/components/events/EventPlayer";
import { APP_NAME, pageTitle } from "@/lib/brand";
import { EVENTS, eventEntry } from "@/lib/ui/event-catalog";

type Params = Promise<{ id: string }>;

export function generateStaticParams() {
  return EVENTS.map((e) => ({ id: e.id }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const entry = eventEntry((await params).id);
  return entry ? { title: pageTitle(entry.title), description: entry.hook } : { title: APP_NAME };
}

export default async function EventPage({ params }: { params: Params }) {
  const entry = eventEntry((await params).id);
  if (!entry) notFound();
  return (
    <>
      <EventPlayer entry={entry} />
      <noscript>
        <p className="noscript">{APP_NAME} needs JavaScript to draw this replay. The wind comes from NOAA&rsquo;s HRRR model, the track from the National Hurricane Center and the reports from the National Weather Service.</p>
      </noscript>
    </>
  );
}
