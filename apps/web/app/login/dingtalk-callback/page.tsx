import { DingTalkCallbackClient } from "./DingTalkCallbackClient";

type PageProps = {
  searchParams: Promise<{
    authCode?: string;
    code?: string;
    state?: string;
  }>;
};

export default async function DingTalkCallbackPage({ searchParams }: PageProps) {
  const params = await searchParams;
  return (
    <DingTalkCallbackClient
      code={params.authCode ?? params.code ?? ""}
      state={params.state ?? ""}
    />
  );
}
