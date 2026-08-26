import { readdir, readFile } from "node:fs/promises"
import { basename, join, relative } from "node:path"
import { describe, expect, test } from "vitest"

const sourceDirectory = join(process.cwd(), "src")
const visualDeclaration =
  /^\s*(?:-webkit-text-fill-color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|color))?|box-shadow|color|filter|font-weight|line-height|opacity|outline|scrollbar-color|transform)\s*:\s*([^;]+);/gim
const rawVisualValue = /#[0-9a-f]{3,8}\b|\b(?:hsl|rgb)a?\(|\b(?:linear|radial)-gradient\(|\burl\(/gi
const absoluteLength = /-?\d*\.?\d+(?:px|rem|em)\b/gi
const rawNumericValue = /(?:^|[^\w-])-?\d*\.?\d+(?:%|[a-z]+)?(?:\b|$)/i

const isUntokenizedDeclaration = (value: string) => {
  if (!value.includes("var(")) return true
  return rawNumericValue.test(value.replace(/var\([^)]*\)/g, ""))
}

async function findCssModules(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return findCssModules(path)
      return entry.isFile() && entry.name.endsWith(".module.css") ? [path] : []
    }),
  )
  return files.flat()
}

const modules = await findCssModules(sourceDirectory)

describe("CSS module tokens", () => {
  test("discovers component styles", () => {
    expect(modules.length).toBeGreaterThan(0)
  })

  for (const modulePath of modules) {
    test(relative(sourceDirectory, modulePath), async () => {
      const css = await readFile(modulePath, "utf8")
      const declarations = Array.from(css.matchAll(visualDeclaration))
        .filter((match) => isUntokenizedDeclaration(match[1] ?? ""))
        .map((match) => match[0])
      const rawVisuals = Array.from(css.matchAll(rawVisualValue), (match) => match[0])
      const lengths = Array.from(css.matchAll(absoluteLength), (match) => match[0])

      expect(declarations, `${basename(modulePath)} contains an untokenized visual style`).toEqual(
        [],
      )
      expect(rawVisuals, `${basename(modulePath)} contains a raw visual value`).toEqual([])
      expect(lengths, `${basename(modulePath)} contains an untokenized absolute length`).toEqual([])
    })
  }

  test("rejects raw values mixed into tokenized declarations", () => {
    expect(isUntokenizedDeclaration("blur(var(--blur)) brightness(1.2)")).toBe(true)
    expect(isUntokenizedDeclaration("blur(var(--blur))")).toBe(false)
  })
})
