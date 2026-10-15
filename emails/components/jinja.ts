/** Build-time tokens only. Never pass user content to code() or expression(). */
export class JinjaTokens {
  private readonly replacements = new Map<string, string>()

  code(source: string): string {
    const token = `OBLIDOG_JINJA_${this.replacements.size}_TOKEN`
    this.replacements.set(token, source)
    return token
  }

  expression(source: string): string {
    return this.code(`{{ ${source} }}`)
  }

  restore(html: string): string {
    let result = html
    for (const [token, source] of this.replacements) {
      if (!result.includes(token))
        throw new Error(`React Email dropped ${token}`)
      result = result.replaceAll(token, () => source)
    }
    if (/OBLIDOG_JINJA_\d+_TOKEN/.test(result))
      throw new Error("Unresolved Jinja token")
    return result
  }
}
