# When to fake something

A fake (mock, stub, in-memory stand-in) replaces a real part so a test can run alone. It also hides real behavior, so keep fakes to the edge of the system. The examples are pseudo-code; translate to the project's language and runner.

## Fake only at the system edge

Fake what lives outside your code or cannot be made repeatable:

- external services you do not run (payment, email, a third-party API),
- the clock and sources of randomness,
- the database, sometimes: prefer a real test database or an in-memory one that follows the same rules,
- the file system, sometimes: prefer a temporary folder the test creates and removes.

Do not fake:

- your own classes and modules,
- internal collaborators,
- anything the project controls and can run for real.

A fake of your own code makes the test check the fake. It also ties the test to the current inner structure, which is the coupling `tests.md` warns about.

## Make the edge easy to fake

### 1. Pass dependencies in

Give a function the outside service it needs instead of letting it build one inside.

```
// easy to fake: the caller supplies the client
function processPayment(order, paymentClient):
    return paymentClient.charge(order.total)

// hard to fake: the function builds a real client from real credentials
function processPayment(order):
    client = new PaymentClient(env.PAYMENT_KEY)
    return client.charge(order.total)
```

In the second form a test either needs real credentials or must patch the language's internals.

### 2. One narrow function per outside operation

Wrap the outside service in specific operations, not one generic "send anything" function.

```
// GOOD: each operation can be faked on its own
api = {
    getUser(id):            http.get("/users/" + id),
    getOrders(userId):      http.get("/users/" + userId + "/orders"),
    createOrder(data):      http.post("/orders", data),
}

// BAD: a fake has to decide, by looking at the arguments, what to return
api = {
    request(endpoint, options): http.send(endpoint, options),
}
```

With the narrow form:

- each fake returns one known shape,
- the test setup has no branching,
- the test shows which operations it uses,
- a type checker, where the language has one, can check each operation separately.

## Fakes drift

A fake that no longer matches the real service gives a green test and a broken system. Where the service offers a test mode or a sandbox, run a few tests against it in a separate, slower run. When you write a fake's reply, copy the shape from a real response, not from memory.
