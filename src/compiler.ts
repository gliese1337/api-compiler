export interface OpSpec {
  inputs: string[];
  outputs: string;
  fn: Function;
  async?: boolean;
}

function *reverseDependencies(deps: Iterable<OpSpec>, params: Set<string>) {
  for (const { outputs, inputs } of deps) {
    if (inputs.some((i) => params.has(i))) { yield outputs; }
  }
}

async function calcValue(deps: Map<string, OpSpec>, req: string, vals: { [key: string]: unknown }) {
  if (vals.hasOwnProperty(req)) { return vals[req]; }
  const op = deps.get(req);
  if (!op) { throw { missing: req }; }
  const args: unknown[] = await Promise.all(op.inputs.map((n) => calcValue(deps, n, vals)));
  const val = await op.fn(...args);
  vals[req] = val;
  return val;
}

// tslint:disable-next-line no-empty
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;

export class Compiler {
  private deps = new Map<string, OpSpec>();
  private cache = new Map<string, Function>();

  constructor(optable: Iterable<Function | OpSpec>) {
    for (const spec of optable) {
      if (typeof spec !== "function") {
        this.deps.set(spec.outputs, spec);
      } else {
        // Extract the name and formal parameters of a formula
        // by parsing the source code, and registers the formula
        // in the dependencies map.
        const match = spec.toString()
          .match(/^(async)?(?:function)?\s*(\w+)\s*(\([\s\S]*?\))*.*/);
        if (match) {
          const [ , a, name, argstring ] = match;

          this.deps.set(name, {
            async: !!a,
            fn: spec,
            inputs: argstring.match(/\w+/g) as string[],
            outputs: name,
          });
        }
      }
    }
  }

  public getParams(reqs: Iterable<string>, precomputed: Iterable<string> = []) {
    const { intermediates, params } = this.linearize(reqs, precomputed);

    return { intermediates: [ ...intermediates ], params };
  }

  public compile(reqs: Iterable<string>, precomputed: Iterable<string> = []) {
    precomputed = [ ...precomputed ];
    const returns = [ ...reqs ];
    const { deps } = this;

    // Get the linearized operation list
    // and set of required parameters to
    // compute the requested values.
    const { ops, params } = this.linearize(returns, precomputed);

    // Generate maps from arbitrary API value names to valid JS identifiers

    const pids: { [key: string]: string} = {};
    let count = 0;
    for (const param of params) {
      pids[param] = `v${ count++ }`;
    }

    const vids: { [key: string]: string} = {};
    for (const { output } of ops) {
      vids[output] = `v${ count++ }`;
    }

    const ids = { ...pids, ...vids };

    // Assemble the function body

    const destructure = Object.entries(pids).map(([ key, value ]) => `'${key}':${ value }`).join(", ");

    const calcs = ops.map(({ output, params, async }) => // tslint:disable-line no-shadowed-variable
      `const ${vids[output]} = ${ async ? "await" : "" } formulas.${vids[output]}(${ params.map((p) => ids[p]).join(",") });`);

    const retmap = returns.map((v) => `'${ v }':${ ids[v] }`);

    const body = `const {${ destructure }} = args;\n${ calcs.join("\n") }\nreturn {${ retmap.join(",") }};`;

    // Compile the new function and bind statically-required values

    const isAsync = ops.some(({ async }) => async);
    const calculator = new (isAsync ? AsyncFunction : Function)("formulas", "args", body);

    const formulas: { [key: string]: Function } = {};
    for (const { outputs, fn } of deps.values()) {
      formulas[vids[outputs]] = fn;
    }

    // tslint:disable-next-line no-shadowed-variable
    return (function(f: Function, formulas: { [key: string]: Function }, args: { [key: string]: unknown }) {
      const missing = params.filter((p) => !args.hasOwnProperty(p));
      if (missing.length) {
        const uncalculable = [ ...reverseDependencies(deps.values(), new Set(missing)) ];
        throw new Error(`Missing arguments: Calculating [${ uncalculable.join(", ") }] requires [${ missing.join(", ") }] as input`);
      }

      return f(formulas, args);
    }).bind(null, calculator, formulas);
  }

  public getCalculator(reqs: Iterable<string>, precomputed: Iterable<string> = []) {
    const returns = [ ...reqs ];
    const { cache } = this;

    let key = returns.sort().join("\0");
    let f: Function | undefined;

    const pre = [ ...precomputed ];
    if (pre.length > 0) {
      const { params } = this.getParams(returns, precomputed);
      key += "\0\0" + pre.filter((n) => params.includes(n)).sort().join("\0");
      f = cache.get(key);
      if (f) { return f; }
      f = this.compile(returns, pre);
    } else {
      f = cache.get(key);
      if (f) { return f; }
      f = this.compile(returns);
    }

    cache.set(key, f);

    return f;
  }

  public calculate(reqs: Iterable<string>, args: { [key: string]: unknown }): { [key: string]: unknown } {
    return this.getCalculator(reqs, Object.keys(args))(args);
  }

  public async interpret(reqs: Iterable<string>, args: { [key: string]: unknown }) {
    const { deps } = this;
    const vals = { ...args };

    const ret: { [key: string]: unknown } = {};
    for (const val of reqs) {
      try {
        ret[val] = await calcValue(deps, val, vals);
      } catch (e) {
        if (e.missing) {
          throw new Error(`Cannot calculate [${ val }]; missing required input [${ e.missing }].`);
        }

        throw e;
      }
    }

    return ret;
  }

  // Recursively traverse the dependency DAG encoded
  // in the formal parameters of each formula, starting
  // from the values requested, and emitting calculations
  // in a reverse topological order. Values with no entry
  // in the dependencies map are assumed to be inputs,
  // and are distinguished so that they can be gathered
  // at the top of the compiled function rather than
  // being individually extracted immediately before they
  // are needed by a formula.
  private *traverse(reqs: Iterable<string>, precomputed: Set<string>, visited: Set<string>):
    Generator<{ computation?: { output: string, params: string[], async: boolean }, input?: string }> {
    const { deps } = this;
    for (const val of reqs) {
      // If we've seen this value before, we can bail,
      // because it will already have been calculated
      // as a shared dependency of some other value
      if (visited.has(val)) {
        continue;
      }

      visited.add(val);

      // This value is available pre-computed, so emit
      // it as an input to notify the client that they
      // must provide it, and don't bother with the
      // rest of the dependency tree.
      if (precomputed.has(val)) {
        yield { input: val };
        continue;
      }

      const op = deps.get(val);
      if (op) {
        // yield all of the dependencies for a formula,
        // followed by the calculation itself, thus
        // guaranteeing that all necessary values will
        // have been precomputed before any formulas
        // that use them.
        const params = op.inputs;

        yield* this.traverse(params, precomputed, visited);
        yield { computation: { output: val, params, async: !!op.async } };
      } else {
        yield { input: val }; // yield an input parameter
      }
    }
  }

  // Linearize the the dependency DAG encoded in the
  // formal parameters of each formula and rooted at
  // the requested values using the `traverse()`
  // generator to produce a reverse topological sort,
  // and return the ordered operations and set of
  // required inputs.
  private linearize(reqs: Iterable<string>, precomputed: Iterable<string> = []) {
    const ops: Array<{ output: string, params: string[], async: boolean }> = [];
    const intermediates = new Set<string>();
    const params: string[] = [];

    for (const { input, computation } of this.traverse(reqs, new Set(precomputed), new Set())) {
      if (computation) {
        ops.push(computation);
        intermediates.add(computation.output);
      } else if (input) {
        params.push(input);
      }
    }

    return { ops, params, intermediates };
  }
}
