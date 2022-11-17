API Compiler
============

API Compiler is a library that lets you treat your API as a declarative programming language, and compile API requests into JS code for optimized performance.

The API Compiler solves a very specific type of problem:

1. You have an API that allows requesting various calculated values
2. Some of these calculations can take a long time to run
3. Some of these calculations can share intermediate values

Because some of your calculations take a long time to run, you only want to calculate what the client actually needs on any given request. And because some of your calculations can share intermediate values, you can save time by batching requests and only calculating the shared values once. And you want to figure out which values can be shared and the optimal order to compute them in as efficiently as possible.

In order to solve that kind of problem, API Compiler requires that you describe your calculations in terms of small functions that calculate intermediate or final values given some input values, and specify what the inputs and outputs are. If you provide the compiler with a bare function object, it will use reflection to extract the name of the function as the name of its calculated value, and the names of the formal parameters to the function, from that function's source code. As that can be rather brittle, however, you also have the option to more explicitly specify the output and input value names for any function in an `OpSpec` object, of the form `{ inputs: string[], outputs: string, fn: Function, async?: boolean }`. At the moment, only single-value outputs are supported. Support for multivalue return is planned in a later version.

Once a `Compiler` object is constructed with a list of your calculation functions, the API Compiler can automatically construct a dependency graph for any set of values you might want to calculate, and

1. Answer queries about which minimal inputs are required to produce certain outputs, and
2. Compile an optimized function for calculating exactly those output values with minimal wasted computation.

API Compiler API
----------------

The package exports an `OpSpec` type (described above), a `SerializedFn` type, and a `Compiler` constructor.

The `SerializedFn` interface contains a JSON-serializable representation of all of the information generated during compilation that can be used to reconstruct a compiled calculator function for a given set of parameters and desired outputs.

```ts
interface SerializedFn {
    formulas: Record<string, string>;
    params: string[];
    returns: string[];
    isAsync: boolean;
    body: string;
}
```

`Compiler` instances have the following interface:

* `new Compiler(optable: Iterable<Function | OpSpec>)` Given a list of operations, construct a compiler for the declarative language implied by that set of interdependent operations.
* `getParams(reqs: Iterable<string>, precomputed?: Iterable<string>): { params: string[], intermediates: string[] }` Returns the list of required input parameters and incidentally-computed intermediate values for a given set of requested values. If a set of precomputed value names is provided, this method will determine which of those values are useful in the computation of the requested values, and give back a modified parameter list that includes those available precomputed values that would be useful. This allows the compiler to create more optimized functions that avoid recomputing intermediate values unnecessarily if the client is known to be able to provide them.
* `compile(reqs: Iterable<string>, precomputed?: Iterable<string>): [(args: { [key: string]: unknown }) => Promise<{ [key: string]: unknown }>, SerializedFn]` Returns a compiled function to calculate the requested values given appropriate inputs, possibly accounting for precomputed intermediate values available from the client, along with an object representation suitable for JSON serialization so that compiled function data can be cached across program runs, and caches the compiled function internally.
* `loadSource(source: string | SerializedFn): (args: { [key: string]: unknown }) => Promise<{ [key: string]: unknown }>` Reconstitutes a compiled function from serialized source, returns it, and caches it internally.
* `getCalculator(reqs: Iterable<string>, precomputed?: Iterable<string>): (args: { [key: string]: unknown }) => Promise<{ [key: string]: unknown }>` This method is functionally identical to `compile`, but it checks the internal cache before initiating a new compilation cycle so as to amortize the cost of compilation over multiple runs of the same calculation function.
* `calculate(reqs: Iterable<string>, args: { [key: string]: unknown }): Promise<{ [key: string]: unknown }>` Internally uses `getCalculator` to acquire an optimal compiled function, accounting for any precomputed intermediate values that may have been provided in the `args` object along with basic required parameters, and immediately applies it to calculate the requested values. If any required arguments are missing, it throws an error describing which inputs are missing and which requested values require them, so that the request can be repeated either without the uncomputable requests or with the minimum additional required arguments provided.
* `interpret(reqs: Iterable<string>, args: { [key: string]: unknown }): Promise<{ [key: string]: unknown }>` As the compilation step has some overhead, this method provides access to an interpreter mode which will traverse the dependency graph computing any intermediate values it needs to immediately and returning the requested results. This is a good option for APIs that expect infrequent repetitions of the same type of request, such that we cannot expect to amortize the cost of compilation over multiple requests. However, it is unable to provide as detailed error messages as a compiled function would.

Roadmap
-------

The following features are planned for future versions:

* Support for multi-value returns from operator implementations, along with a solver to pick the best set of implementations if the same value is available via multiple routes (possibly in combination with different sets of other values).
* Support for WASM operator implementations, with compilation to a single WASM module for better numnerical performance.
* Support for mixed WASM and JS operations.