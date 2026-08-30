import { Shell } from "@/components/Shell";
import { ListingForm } from "@/components/ListingForm";
import { createListing } from "../actions";

export const metadata = { title: "New listing" };

export default function NewListingPage() {
  return (
    <Shell title="New listing">
      <div className="rounded-card border border-sand-200 bg-white p-6">
        <ListingForm action={createListing} />
      </div>
    </Shell>
  );
}
