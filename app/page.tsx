import { auth, signIn } from "@/auth";
import Link from "next/link";

export default async function HomePage() {
  const session = await auth();

  async function handleSignIn() {
    "use server";
    await signIn("google");
  }

  return (
    <div className="container">
      <p className="eyebrow">IMAX 70mm Tracker</p>
      <h1>Know the second a 70mm print threads at your theatre.</h1>
      <p>
        We poll AMC and Regal showtime feeds around the clock for true IMAX
        70mm (and 15/70) presentations at six theatres across Northern and
        Southern California. The moment a matching showtime appears, you get
        an email with the times and a ticket link &mdash; plus a couple of
        follow-up reminders so you don&apos;t miss the good seats.
      </p>

      <div className="panel">
        {session?.user ? (
          <>
            <p style={{ marginBottom: 16 }}>
              Signed in as {session.user.email ?? session.user.name}.
            </p>
            <Link className="btn" href="/dashboard">
              Go to dashboard
            </Link>
          </>
        ) : (
          <form action={handleSignIn}>
            <button className="btn" type="submit">
              Sign in with Google
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
