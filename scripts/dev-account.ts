// npm run dev:account — konto próbne TYLKO do pracy lokalnej (oglądanie ekranów przed kreatorem z kroku 6).
// Zakłada albo resetuje konto admin@lokalnie.test w lokalnej bazie z DATABASE_URL: nowe losowe hasło (wypisane raz),
// para kluczy, 2FA do skonfigurowania przy pierwszym logowaniu.
// Odmawia, gdy: NODE_ENV=production, baza nie jest lokalna, nazwa bazy wygląda na hostingową (uNNN_…)
// albo w bazie jest jakiekolwiek inne konto. Nie jest częścią zbudowanej aplikacji.
import { randomBytes, randomUUID } from 'node:crypto'
import { eq, ne } from 'drizzle-orm'
import { deriveKeys, newKdfSalt, KDF_ITERATIONS } from '../src/client/crypto/kdf'
import { exportPublicKey, generateUserKeyPair, wrapPrivateKey } from '../src/client/crypto/keys'
import { toBase64 } from '../src/client/crypto/encoding'
import '../src/server/config'
import { openDb, runMigrations } from '../src/server/db/connection'
import { authSessions, keySlots, users } from '../src/server/db/schema'
import { hashAuthKey } from '../src/server/auth/password'

const EMAIL = 'admin@lokalnie.test'

function localDatabaseUrl(): string {
  if (process.env.NODE_ENV === 'production') throw new Error('Odmowa: NODE_ENV=production')
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error('Brak DATABASE_URL w .env')
  const url = new URL(raw)
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Odmowa: baza nie jest lokalna')
  if (/^u\d+_/.test(url.pathname.slice(1))) throw new Error('Odmowa: nazwa bazy wygląda na bazę z hostingu')
  return raw
}

async function main() {
  const { db, close } = await openDb(localDatabaseUrl())
  try {
    await runMigrations(db)
    const others = await db.select({ id: users.id }).from(users).where(ne(users.email, EMAIL)).limit(1)
    if (others.length) throw new Error('Odmowa: w bazie są inne konta (to nie jest pusta baza do pracy lokalnej)')

    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, EMAIL))
    const id = existing?.id ?? randomUUID()
    const password = randomBytes(15).toString('base64url')
    const salt = newKdfSalt()
    const { authKey, wrapKey } = await deriveKeys(password, salt, KDF_ITERATIONS)
    const pair = await generateUserKeyPair()
    const now = new Date()
    const auth = {
      status: 'active',
      kdfSalt: toBase64(salt),
      kdfIterations: KDF_ITERATIONS,
      authHash: await hashAuthKey(authKey),
      publicKey: await exportPublicKey(pair.publicKey),
      privateKeyEnc: await wrapPrivateKey(pair.privateKey, wrapKey, id),
      totpSecretEnc: null,
      totpEnabledAt: null,
      totpLastStep: null,
      failedAttempts: 0,
      lockedUntil: null
    }
    if (existing) {
      await db.delete(authSessions).where(eq(authSessions.userId, id))
      await db.delete(keySlots).where(eq(keySlots.userId, id))
      await db.update(users).set(auth).where(eq(users.id, id))
    } else {
      await db.insert(users).values({ id, createdAt: now, updatedAt: now, updatedBy: id, version: 1, email: EMAIL, name: 'Konto próbne', role: 'admin', ...auth })
    }
    console.log(`Konto próbne ${existing ? 'zresetowane' : 'założone'} (tylko lokalnie).`)
    console.log(`  E-mail: ${EMAIL}`)
    console.log(`  Hasło:  ${password}`)
    console.log('Przy pierwszym logowaniu skonfigurujesz 2FA. Hasło nie jest nigdzie zapisane: ponowne uruchomienie nada nowe.')
  } finally {
    await close()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
