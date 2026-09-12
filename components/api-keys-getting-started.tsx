"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronDown, Copy, ExternalLink, Rocket } from 'lucide-react'
import { toast } from "sonner"
import { Card } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

const DOCS_BASE_URL = "https://docs.programmableinbox.com"

const SDK_SNIPPETS = {
  python: {
    label: "Python",
    install: "pip install programmableinbox",
    code: 'from programmableinbox import Client\n\nclient = Client(api_key="{key}")\nclient.email_inboxes.list()',
  },
  typescript: {
    label: "TypeScript",
    install: "npm install @programmableinbox/sdk",
    code: 'import { ProgrammableInbox } from "@programmableinbox/sdk"\n\nconst client = new ProgrammableInbox({ apiKey: "{key}" })\nawait client.emailInboxes.list()',
  },
  go: {
    label: "Go",
    install: "go get github.com/roshansingh/programmableinbox/sdk/go",
    code: 'client := pibx.NewClient("{key}")\ninboxes, err := client.EmailInboxes.List(ctx)',
  },
  csharp: {
    label: "C#",
    install: "dotnet add package ProgrammableInbox.Sdk",
    code: 'var client = new ProgrammableInboxClient("{key}");\nvar inboxes = await client.EmailInboxes.ListAsync();',
  },
} as const

type SdkLanguage = keyof typeof SDK_SNIPPETS

function CodeBlock({ code }: { code: string }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    toast.success("Copied to clipboard")
  }

  return (
    <div className="relative">
      <pre className="bg-muted rounded-md px-3 py-2.5 pr-10 font-mono text-xs leading-relaxed overflow-x-auto whitespace-pre">
        {code}
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        aria-label="Copy to clipboard"
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
export function ApiKeysGettingStarted({ examplePrefix }: { examplePrefix?: string }) {
  const [sdkLang, setSdkLang] = useState<SdkLanguage>("python")
  const keyPlaceholder = examplePrefix ? `${examplePrefix}...` : "sk_live_..."

  const curlSnippet = `curl https://app.programmableinbox.com/api/v1/emailInbox \\\n  -H "Authorization: Bearer ${keyPlaceholder}"`
  const mcpSnippet = `claude mcp add --transport http programmableinbox \\\n  https://app.programmableinbox.com/api/mcp \\\n  --header "Authorization: Bearer ${keyPlaceholder}"`
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
            <TabsList>
              <TabsTrigger value="api">API</TabsTrigger>
              <TabsTrigger value="sdk">SDK</TabsTrigger>
              <TabsTrigger value="mcp">MCP</TabsTrigger>
            </TabsList>

            <TabsContent value="api" className="space-y-3 pt-3">
              <CodeBlock code={curlSnippet} />
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
              <CodeBlock code={sdkSnippet.install} />
              <CodeBlock code={sdkCode} />
              <DocsLink href={`${DOCS_BASE_URL}/sdks/overview`}>All SDKs</DocsLink>
            </TabsContent>

            <TabsContent value="mcp" className="space-y-3 pt-3">
              <CodeBlock code={mcpSnippet} />
              <DocsLink href={`${DOCS_BASE_URL}/mcp/setup`}>MCP setup guide</DocsLink>
            </TabsContent>
          </Tabs>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
