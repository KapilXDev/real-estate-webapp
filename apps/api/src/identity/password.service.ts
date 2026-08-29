import { Injectable } from "@nestjs/common";
import * as argon2 from "argon2";

/**
 * Password hashing.
 *
 * Argon2id, chosen over bcrypt: bcrypt silently truncates at 72 bytes and has no memory-hardness,
 * which is what actually defeats GPU cracking. Argon2id is the OWASP first choice.
 *
 * ⚠️ argon2 is a native module. If node-gyp did not run it silently no-ops rather than failing
 * loudly — verify a hash starts with `$argon2id$` after any dependency change. See BUILD_LOG
 * step 9; `npm approve-scripts` had to be run for exactly this reason.
 */

/**
 * OWASP-recommended baseline: 19 MiB memory, 2 iterations, parallelism 1.
 *
 * Memory cost is the parameter that matters — it is what makes parallel GPU attacks expensive.
 * Raising `timeCost` looks like extra security but buys far less per millisecond of login latency.
 *
 * ⚠️ `raw` is left unset deliberately. argon2's `hash()` is overloaded on it: `raw: true` returns
 * a Buffer, anything else returns the encoded string we actually want to store.
 */
const HASH_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * A valid Argon2id hash of a random value, used to burn time on unknown accounts.
 * Built lazily once per process — see `fakeVerify`.
 */
let dummyHash: string | undefined;

@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, HASH_OPTIONS);
  }

  /**
   * Verify a password.
   *
   * No options are passed: Argon2 encodes its parameters inside the digest, so verification reads
   * them from the hash itself. That is what makes `needsRehash` and transparent upgrades possible.
   *
   * Returns false rather than throwing on a malformed hash — a corrupt row should fail the login,
   * not 500 the endpoint and tell an attacker they found something interesting.
   */
  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /**
   * Burn roughly one verification's worth of time against a dummy hash.
   *
   * ⚠️ WHY THIS EXISTS: if login skips hashing when the email is unknown, it answers in ~1ms
   * instead of ~50ms, and that difference is a reliable oracle for enumerating which email
   * addresses have accounts. Calling this on the unknown-user path keeps both branches
   * comparable. It is not perfect constant-time, but it removes the trivially measurable gap.
   */
  async fakeVerify(plain: string): Promise<false> {
    // Not a real credential — only ever compared against, never accepted.
    dummyHash ??= await argon2.hash(
      `dummy:${Math.random()}:${Date.now()}`,
      HASH_OPTIONS,
    );
    await this.verify(dummyHash, plain);
    return false;
  }

  /**
   * True when a stored hash was produced with weaker parameters than we now use, so the caller
   * can transparently re-hash on the next successful login.
   */
  needsRehash(hash: string): boolean {
    try {
      // `needsRehash` compares only cost parameters — it takes no `type`, since a digest of a
      // different Argon2 variant is a different algorithm rather than weaker settings.
      return argon2.needsRehash(hash, {
        memoryCost: HASH_OPTIONS.memoryCost,
        timeCost: HASH_OPTIONS.timeCost,
        parallelism: HASH_OPTIONS.parallelism,
      });
    } catch {
      // Unparseable hash — treat as needing replacement rather than trusting it.
      return true;
    }
  }
}
