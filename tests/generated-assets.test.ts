import { readFileSync } from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

import { describe, expect, test } from 'vitest'

const root = path.resolve(__dirname, '..')

type Rgba = {
  r: number
  g: number
  b: number
  a: number
}

function readPng(filePath: string) {
  const png = readFileSync(path.join(root, filePath))
  const signature = png.subarray(0, 8).toString('hex')
  expect(signature).toBe('89504e470d0a1a0a')

  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat: Buffer[] = []

  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.subarray(offset + 4, offset + 8).toString('ascii')
    const data = png.subarray(offset + 8, offset + 8 + length)

    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    }

    if (type === 'IDAT') idat.push(data)
    if (type === 'IEND') break

    offset += length + 12
  }

  return { width, height, bitDepth, colorType, data: zlib.inflateSync(Buffer.concat(idat)) }
}

function bytesPerPixel(colorType: number) {
  if (colorType === 6) return 4
  if (colorType === 2) return 3
  throw new Error(`Unsupported PNG color type ${colorType}`)
}

function unfilterPng(filePath: string) {
  const png = readPng(filePath)
  expect(png.bitDepth).toBe(8)

  const bpp = bytesPerPixel(png.colorType)
  const stride = png.width * bpp
  const rows: Buffer[] = []
  let sourceOffset = 0

  for (let y = 0; y < png.height; y += 1) {
    const filter = png.data[sourceOffset]
    sourceOffset += 1
    const row = Buffer.from(png.data.subarray(sourceOffset, sourceOffset + stride))
    sourceOffset += stride
    const previous = rows[y - 1]

    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? row[x - bpp] : 0
      const up = previous ? previous[x] : 0
      const upLeft = previous && x >= bpp ? previous[x - bpp] : 0

      if (filter === 1) row[x] = (row[x] + left) & 0xff
      if (filter === 2) row[x] = (row[x] + up) & 0xff
      if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 0xff
      if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
        row[x] = (row[x] + predictor) & 0xff
      }
    }

    rows.push(row)
  }

  return { ...png, bpp, rows }
}

function pixelAt(filePath: string, x: number, y: number): Rgba {
  const png = unfilterPng(filePath)
  const rowOffset = x * png.bpp
  const row = png.rows[y]
  return {
    r: row[rowOffset],
    g: row[rowOffset + 1],
    b: row[rowOffset + 2],
    a: png.bpp === 4 ? row[rowOffset + 3] : 255,
  }
}

function visiblePixels(filePath: string) {
  const png = unfilterPng(filePath)
  const pixels: Rgba[] = []

  for (const row of png.rows) {
    for (let x = 0; x < png.width; x += 1) {
      const offset = x * png.bpp
      const pixel = {
        r: row[offset],
        g: row[offset + 1],
        b: row[offset + 2],
        a: png.bpp === 4 ? row[offset + 3] : 255,
      }
      if (pixel.a > 16) pixels.push(pixel)
    }
  }

  return pixels
}

describe('generated assets', () => {
  test('app icon uses the native CPA diamond knot mark', () => {
    const svg = readFileSync(path.join(root, 'assets/brand/cpa-desktop-icon.svg'), 'utf8')

    expect(svg).toContain('id="cpa-native-mark"')
    expect(svg).toContain('id="cpa-diamond"')
    expect(svg).toContain('id="cpa-knot"')
    expect(svg).not.toContain('M300 512c0-119')
    expect(svg).not.toContain('M724 512c0 119')
  })

  test('app icon keeps transparent launcher corners', () => {
    const icon = readPng('assets/brand/cpa-desktop-icon.png')
    expect(icon.colorType).toBe(6)

    expect(pixelAt('assets/brand/cpa-desktop-icon.png', 0, 0).a).toBe(0)
    expect(pixelAt('assets/brand/cpa-desktop-icon.png', 1023, 0).a).toBe(0)
    expect(pixelAt('assets/brand/cpa-desktop-icon.png', 0, 1023).a).toBe(0)
    expect(pixelAt('assets/brand/cpa-desktop-icon.png', 1023, 1023).a).toBe(0)
  })

  test('cross-platform icon has visible pixels on dark taskbars', () => {
    const pixels = visiblePixels('src-tauri/icons/icon.png')
    const averageLuma =
      pixels.reduce((total, { r, g, b }) => total + 0.2126 * r + 0.7152 * g + 0.0722 * b, 0) /
      pixels.length

    expect(averageLuma).toBeGreaterThan(150)
  })
})

describe('README imagery section', () => {
  const readme = readFileSync(path.join(root, 'README.md'), 'utf8')

  test('does not label illustrative renders as real screenshots', () => {
    expect(readme).not.toContain('## Screenshots')
    expect(readme).not.toContain("Dashboard shows CPA's built-in management panel")
  })

  test('does not squeeze README images into a three-column table', () => {
    expect(readme).not.toMatch(/\|\s*!\[Dashboard\]\(assets\/readme\/dashboard\.png\)\s*\|/)
    expect(readme).toContain('![Dashboard preview](assets/readme/dashboard.png)')
    expect(readme).toContain('![Logs preview](assets/readme/logs.png)')
    expect(readme).toContain('![Settings preview](assets/readme/settings.png)')
  })
})
