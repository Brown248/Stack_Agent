# Good and bad tests

The examples use plain pseudo-code (`test`, `assert`) that maps onto any language and any test runner. Translate to the project's own.

## Good tests

Run the real code through its public interface. Fake only what `mocking.md` allows.

```
// GOOD: checks what a caller can observe
test "a cart with one valid item checks out as confirmed":
    cart = newCart()
    cart.add(validProduct)
    result = checkout(cart, testPaymentMethod)
    assert result.status equals "confirmed"
```

A good test:

- checks behavior that a user or a caller cares about,
- uses the public interface only,
- survives internal refactors,
- says what happens, not how,
- makes one logical point (several asserts are fine when they describe the same outcome).

## Bad tests

### Coupled to the inside

```
// BAD: checks how the code works, not what it does
test "checkout calls paymentService.process":
    fakePayment = replace(paymentService)
    checkout(cart, payment)
    assert fakePayment.process was called with cart.total
```

Warning signs:

- an internal collaborator is replaced by a fake,
- a private method is called or asserted on,
- the test counts calls or checks their order,
- it fails after a refactor that changed no behavior,
- its name describes how ("calls X") instead of what ("refuses an empty cart"),
- it checks the result by another route than the interface.

### Going around the interface

```
// BAD: reads storage directly
test "createUser saves to the database":
    createUser({ name: "Alice" })
    row = database.query("select * from users where name = 'Alice'")
    assert row exists

// GOOD: asks the system through its own interface
test "a created user can be fetched":
    user = createUser({ name: "Alice" })
    fetched = getUser(user.id)
    assert fetched.name equals "Alice"
```

The bad version breaks when the table is renamed. The good version breaks only when a user can no longer be fetched.

### Tautology

The expected value is computed the way the code computes it, so the test cannot disagree with the code.

```
// BAD: the expectation repeats the implementation
test "calculateTotal sums line items":
    items = [{ price: 10 }, { price: 5 }]
    expected = sum of price over items
    assert calculateTotal(items) equals expected

// GOOD: the expectation is a value worked out by hand
test "calculateTotal sums line items":
    assert calculateTotal([{ price: 10 }, { price: 5 }]) equals 15
```

Other forms of the same fault: a snapshot produced by running the code and saved without review, and a constant asserted equal to itself. Take the expected value from the spec, a worked example, or a known-good literal.

## Checks before you keep a test

- Did you see it fail first, and was the failure the missing behavior?
- Would a rewrite of the inside, with the same behavior, leave it passing?
- Could the expected value have come out wrong if the code were wrong?
