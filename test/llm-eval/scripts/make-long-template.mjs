// Regenerates cases/structure/long-marketing-template/email.html. Deterministic.
// Run: node test/llm-eval/scripts/make-long-template.mjs
import fs from 'node:fs'
import path from 'node:path'

const out = path.resolve(import.meta.dirname, '../cases/structure/long-marketing-template/email.html')

const css = Array.from(
  { length: 60 },
  (_, i) =>
    `.tile-${i} { margin: ${i % 7}px; padding: ${(i % 5) + 4}px; font: 14px/1.5 Helvetica, Arial, sans-serif; color: #${(0x222222 + i * 0x010101).toString(16)}; }`,
).join('\n    ')

const icons = ['facebook', 'instagram', 'x', 'pinterest', 'tiktok', 'youtube']
  .map(
    (n) =>
      `<a href="https://social.example.com/${n}"><img src="https://cdn.example.com/${n}.png" alt="" width="24" height="24"></a>`,
  )
  .join(' ')

const items = [
  'Linen shirt',
  'Wide-leg trousers',
  'Canvas tote',
  'Leather sandals',
  'Straw hat',
  'Cotton dress',
  'Stoneware mug',
  'Beeswax candle',
]

const tiles = Array.from({ length: 24 }, (_, i) => {
  const name = `${items[i % items.length]} No. ${i + 1}`
  return `<tr><td class="tile-${i}"><a href="https://shop.example.com/p/${i + 1}?utm_source=email&utm_campaign=summer-edit">${name}</a>
      <p>${name} is cut from a soft, breathable fabric that holds its shape wash after wash. Available in four colours and sizes XS to XXL, with free returns within thirty days of delivery.</p></td></tr>`
}).join('\n    ')

const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Your summer edit is here</title>
    <style>
    ${css}
    </style>
  </head>
  <body>
    <span style="display:none">New arrivals, restocks and the pieces everyone is talking about.</span>
    <table width="600" align="center">
    <tr><td><a href="https://shop.example.com/"><img src="https://cdn.example.com/logo.png" alt="Acme Home"></a></td></tr>
    <tr><td><a href="https://shop.example.com/summer"><img src="https://cdn.example.com/hero.jpg" alt="Summer edit"></a></td></tr>
    <tr><td><h1>The summer edit</h1><p>Twenty-four pieces chosen by our stylists for long days and warm evenings.</p>
      <p><a href="https://shop.example.com/summer">Shop now</a></p></td></tr>
    ${tiles}
    <tr><td>${icons}</td></tr>
    <tr><td><p>Use code <strong>SUMMER30</strong> for 30% off your first order. Offer ends July 31.</p>
      <p><a href="https://shop.example.com/preferences">Manage preferences</a> · <a href="https://shop.example.com/unsubscribe">Unsubscribe</a> · <a href="https://shop.example.com/privacy">Privacy policy</a></p>
      <p>Acme Home Ltd, 1 Example Street, Anytown. You are receiving this because you signed up at shop.example.com.</p></td></tr>
    </table>
  </body>
</html>
`

fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, html)
console.log(`wrote ${out} (${html.length} bytes)`)
