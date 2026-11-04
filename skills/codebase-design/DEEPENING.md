# Deepening a cluster of shallow modules

How to merge shallow modules into a deep one without losing the ability to test it. The terms (module, interface, seam, adapter) are defined in `SKILL.md` in this folder.

## 1. Classify every dependency

List what the cluster depends on and put each item in one of four kinds. The kind decides how the deepened module is tested across its seam. Name the kind in your recommendation.

### In-process

Pure computation or in-memory state, no I/O. Always safe to deepen: merge the modules and test through the new interface directly. No adapter is needed.

### Local-substitutable

The dependency has a stand-in that runs locally inside the test suite, such as an embedded build of the same database engine or an in-memory filesystem. Deepen it when the stand-in exists, and run the stand-in in the tests. The seam stays internal, so the module's external interface shows no port for it.

### Remote but owned

Your own services across a network (other teams' internal APIs, your own microservices). Define a **port**, which is the interface at the seam. The deep module owns the logic, and the transport arrives as an injected **adapter**. Tests use an in-memory adapter; production uses an HTTP, gRPC or queue adapter. Recommendation shape: "Define a port at the seam, write an HTTP adapter for production and an in-memory adapter for tests, so the logic sits in one deep module even though it is deployed across a network."

### True external

Third-party services you do not control (a payment processor, an SMS provider). The deepened module takes the dependency as an injected port, and tests supply a fake adapter that you write to the port's contract. Never call the real service from a test.

## 2. Seam discipline

- **One adapter is a hypothetical seam; two adapters make a real one.** Add a port only when at least two adapters are justified, typically production and test. A port with one adapter is plain indirection, so leave the call direct.
- **Internal seams versus the external seam.** A deep module may have internal seams, private to its implementation and used by its own tests. Do not lift an internal seam into the interface only because a test uses it.

## 3. Replace tests, do not stack them

1. Write new tests at the deepened module's interface. The interface is the test surface.
2. Delete the old unit tests of the shallow modules once the new tests cover the same behavior. Keeping both doubles the upkeep and makes later refactors fail for no reason.
3. Assert on outcomes a caller can observe through the interface, not on internal state.
4. A test that must change whenever the implementation changes is testing past the interface; move it up to the seam or drop it.

Before deleting an old test, name the new test that now covers its behavior. If none does, keep it. In a project with `.stack-agent/verify.json`, run `node .stack-agent/bin/verify.mjs` after the swap and report the evidence file.
