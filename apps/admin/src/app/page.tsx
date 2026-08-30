import { redirect } from "next/navigation";

/**
 * The root is not a dashboard.
 *
 * A summary screen full of counts is the classic admin default and it is wrong here: the agent
 * opens this tool to do one of two things — put a property up, or answer an enquiry. Landing them
 * on inventory saves a click every single time in exchange for a page nobody reads.
 */
export default function Home() {
  redirect("/listings");
}
