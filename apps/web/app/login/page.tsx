import { LoginClient } from "./LoginClient";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ redirect?: string; error?: string }>;
}) {
  const params = await searchParams;
  const clientProps: { redirect?: string; error?: string } = {};
  if (params.redirect) {
    clientProps.redirect = params.redirect;
  }
  if (params.error) {
    clientProps.error = params.error;
  }
  return (
    <section className="login-page">
      <LoginClient {...clientProps} />
    </section>
  );
}
