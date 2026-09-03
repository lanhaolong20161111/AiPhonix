declare module "bcryptjs" {
  export function hashSync(password: string, salt: string | number): string
  export function compareSync(password: string, hash: string): boolean
  export function hash(password: string, salt: string | number): Promise<string>
  export function compare(password: string, hash: string): Promise<boolean>
  export function genSaltSync(rounds?: number): string
  export function genSalt(rounds?: number): Promise<string>
  const _default: {
    hashSync: typeof hashSync
    compareSync: typeof compareSync
    hash: typeof hash
    compare: typeof compare
    genSaltSync: typeof genSaltSync
    genSalt: typeof genSalt
  }
  export default _default
}
