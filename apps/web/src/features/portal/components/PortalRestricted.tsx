import PortalSignInForm from './sign-in/PortalSignInForm';

// A restricted board the visitor cannot read. Signed in with an address that has no
// access, the form lets them use another one.
export default function PortalRestricted({ slug, signedIn }: { slug: string; signedIn: boolean }) {
  return (
    <section className="mx-auto flex max-w-sm flex-col gap-4 py-16">
      <div className="flex flex-col gap-1">
        <h1 className="text-base font-semibold">This board is private</h1>
        <p className="text-sm text-muted-foreground">
          {signedIn
            ? 'Your email address does not have access. Sign in with an address that does.'
            : 'Sign in with your email address to see it.'}
        </p>
      </div>
      <PortalSignInForm slug={slug} />
    </section>
  );
}
