import assert from "node:assert/strict"
import test from "node:test"
import { resolveBuildVersion } from "./version.mjs"

const sha = "a1b2c3d" + "0".repeat(33)

test("published Docker release keeps its existing label", () => {
  assert.deepEqual(
    resolveBuildVersion("1.2.3", { VITE_APP_VERSION: "v1.2.3" }),
    {
      label: "v1.2.3",
      commit: null,
    },
  )
})

for (const environment of ["preview", "production", "development"]) {
  test(`Vercel ${environment} uses the artifact version and exact commit`, () => {
    const env = {
      VERCEL_ENV: environment,
      VERCEL_GIT_COMMIT_SHA: sha,
      VITE_APP_VERSION: "v0.0.1",
    }
    assert.deepEqual(resolveBuildVersion("1.2.3", env), {
      label: "v1.2.3-dev.a1b2c3d",
      commit: sha,
    })
    assert.notEqual(
      resolveBuildVersion("1.2.3", env).label,
      resolveBuildVersion("1.2.3", {
        ...env,
        VERCEL_GIT_COMMIT_SHA: "b".repeat(40),
      }).label,
    )
  })
}

test("missing or invalid metadata stays explicitly unknown", () => {
  for (const env of [
    {},
    { VITE_APP_VERSION: "dev" },
    { VERCEL: "1" },
    { VERCEL: "1", VERCEL_GIT_COMMIT_SHA: "main" },
  ]) {
    assert.deepEqual(resolveBuildVersion("1.2.3", env), {
      label: "v1.2.3-dev.unknown",
      commit: null,
    })
  }
  assert.deepEqual(resolveBuildVersion(undefined), {
    label: "dev.unknown",
    commit: null,
  })
})

test("only allowlisted metadata is exposed", () => {
  assert.deepEqual(
    Object.keys(resolveBuildVersion("1.2.3", { SECRET: "private" })),
    ["label", "commit"],
  )
})
