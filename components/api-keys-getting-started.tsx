"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ChevronDown, Copy, ExternalLink, Rocket } from 'lucide-react'
import { toast } from "sonner"
import { Card } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import type { ApiKeyListItem } from "@/lib/api/api-keys.api"

const DOCS_BASE_URL = "https://docs.programmableinbox.com"

/**
 * Matches the SDKs' own default host (each sdk/<lang>/README.md) - used for the very
 * first server-rendered paint. A client component still executes that first
 * render during hydration, and `window` isn't available yet at that point,
 * so this has to be a constant rather than `window.location.origin` or the
 * client's first render would mismatch the server's and React would warn.
 * The real origin replaces it a tick later, in the effect below.
 */
const DEFAULT_APP_ORIGIN = "https://app.programmableinbox.com"

// Generated client quick-starts (each sdk/<lang>/README.md) - copy real symbol names,
// not a hand-waved shape, so the pasted snippet actually compiles.
const SDK_SNIPPETS = {
  python: {
    label: "Python",
    install: "pip install programmableinbox",
    code:
      "import programmableinbox\n" +
      "from programmableinbox.api.email_inboxes_api import EmailInboxesApi\n\n" +
      'configuration = programmableinbox.Configuration(access_token="{key}")\n\n' +
      "with programmableinbox.ApiClient(configuration) as api_client:\n" +
      "    api = EmailInboxesApi(api_client)\n" +
      "    print(api.list_email_inboxes().data)",
  },
  typescript: {
    label: "TypeScript",
    install: "npm install @programmableinbox/sdk",
    code:
      "import { Configuration, EmailInboxesApi } from '@programmableinbox/sdk'\n\n" +
      "const config = new Configuration({ accessToken: '{key}' })\n" +
      "const api = new EmailInboxesApi(config)\n" +
      "console.log((await api.listEmailInboxes()).data)",
  },
  go: {
    label: "Go",
    install: "go get github.com/roshansingh/programmableinbox/sdk/go",
    code:
      "configuration := programmableinbox.NewConfiguration()\n" +
      "client := programmableinbox.NewAPIClient(configuration)\n" +
      'ctx := context.WithValue(context.Background(), programmableinbox.ContextAccessToken, "{key}")\n\n' +
      "inboxes, _, err := client.EmailInboxesAPI.ListEmailInboxes(ctx).Execute()",
  },
  csharp: {
    label: "C#",
    install: "dotnet add package ProgrammableInbox.Sdk",
    code:
      "var host = Host.CreateDefaultBuilder()\n" +
      '    .ConfigureApi((_, options) => options.AddTokens(new BearerToken("{key}")))\n' +
      "    .Build();\n\n" +
      "var api = host.Services.GetRequiredService<IEmailInboxesApi>();\n" +
      "var response = await api.ListEmailInboxesAsync();\n" +
      "Console.WriteLine(response.Ok()?.Data);",
  },
} as const

type SdkLanguage = keyof typeof SDK_SNIPPETS

function CodeBlock({ code, label }: { code: string; label: string }) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      toast.success("Copied to clipboard")
    } catch {
      toast.error("Couldn't copy to clipboard")
    }
  }

  return (
    <div className="relative">
      <pre className="bg-background border border-border rounded-md px-3 py-2.5 pr-10 font-mono text-xs leading-relaxed overflow-x-auto whitespace-pre">
        {code}
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={`Copy ${label}`}
        className="absolute top-1.5 right-1.5 rounded-md border border-border bg-card p-1.5 text-muted-foreground hover:text-foreground"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function DocsLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
    >
      {children}
      <ExternalLink className="h-3 w-3" />
    </a>
  )
}

/**
 * Collapsed-by-default banner pointing at the API/SDK/MCP docs. Always
 * rendered above the key list, independent of whether any keys exist yet -
 * unlike the empty-state card, this stays reachable after the first key is
 * created, when someone comes back not remembering how to use it.
 */
export function ApiKeysGettingStarted({ apiKeys = [] }: { apiKeys?: ApiKeyListItem[] }) {
  const [sdkLang, setSdkLang] = useState<SdkLanguage>("python")
  const [origin, setOrigin] = useState(DEFAULT_APP_ORIGIN)

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  // The curl/SDK/MCP examples all call list-inboxes, which needs
  // email_inboxes:read - a key minted without it (message-only keys are
  // valid) would turn the "copy and run" example into a guaranteed 403, so
  // it's excluded from the pool this picks an example prefix from.
  const readScopedKey = apiKeys.find((key) => key.scopes.includes("email_inboxes:read"))
  const keyPlaceholder = readScopedKey ? `${readScopedKey.prefix}...` : "sk_live_..."

  const curlSnippet = `curl ${origin}/api/v1/emailInbox \\\n  -H "Authorization: Bearer ${keyPlaceholder}"`
  const mcpSnippet = `claude mcp add --transport http programmableinbox \\\n  ${origin}/api/mcp \\\n  --header "Authorization: Bearer ${keyPlaceholder}"`
  const sdkSnippet = SDK_SNIPPETS[sdkLang]
  const sdkCode = sdkSnippet.code.replace("{key}", keyPlaceholder)

  return (
    <Card className="gap-0 py-0">
      <Collapsible>
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left sm:px-5">
          <span className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Rocket className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-sm font-semibold">Get started with the API</span>
              <span className="block text-xs text-muted-foreground">curl, an SDK, or MCP &mdash; pick one below</span>
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>

        <CollapsibleContent className="border-t px-4 pt-4 pb-5 sm:px-5 data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden">
          <Tabs defaultValue="api">
            <TabsList className="border border-border bg-background">
              <TabsTrigger value="api">API</TabsTrigger>
              <TabsTrigger value="sdk">SDK</TabsTrigger>
              <TabsTrigger value="mcp">MCP</TabsTrigger>
            </TabsList>

            <TabsContent value="api" className="space-y-3 pt-3">
              <CodeBlock code={curlSnippet} label="curl command" />
              <div className="flex flex-wrap gap-4">
                <DocsLink href={`${DOCS_BASE_URL}/api-reference/authentication-and-scopes`}>
                  API reference
                </DocsLink>
                <Link
                  href="/api-docs"
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  Try it in Swagger
                </Link>
              </div>
            </TabsContent>

            <TabsContent value="sdk" className="space-y-3 pt-3">
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(SDK_SNIPPETS) as SdkLanguage[]).map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => setSdkLang(lang)}
                    aria-pressed={sdkLang === lang}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs font-medium",
                      sdkLang === lang
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {SDK_SNIPPETS[lang].label}
                  </button>
                ))}
              </div>
              <CodeBlock code={sdkSnippet.install} label={`${sdkSnippet.label} install command`} />
              <CodeBlock code={sdkCode} label={`${sdkSnippet.label} example`} />
              <DocsLink href={`${DOCS_BASE_URL}/sdks/overview`}>All SDKs</DocsLink>
            </TabsContent>

            <TabsContent value="mcp" className="space-y-3 pt-3">
              <CodeBlock code={mcpSnippet} label="MCP setup command" />
              <DocsLink href={`${DOCS_BASE_URL}/mcp/setup`}>MCP setup guide</DocsLink>
            </TabsContent>
          </Tabs>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
