export interface OpSpec {
  inputs: string[];
  outputs: string;
  fn: Function;
  async?: boolean;
}

export interface SerializedFn {
  formulas: Record<string,string>;
  params: string[];
  returns: string[];
  isAsync: boolean;
  body: string;
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
  const args: unknown[] = [];
  for (const n of op.inputs) { args.push(await calcValue(deps, n, vals)); }
  const val = await op.fn(...args);
  vals[req] = val;
  return val;
}

// tslint:disable-next-line no-empty
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;

export class Compiler {
  private deps = new Map<string, OpSpec>();
  private fn_cache = new Map<string, Map<string, Function>>();
  private req_cache = new Map<string, { intermediates: string[]; params: string[]; }>();

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
    reqs = [...reqs].sort();
    precomputed = [...precomputed].sort();
    const key = `${(reqs as string[]).join('\0')}\0\0${(precomputed as string[]).join('\0')}`;
    let ret = this.req_cache.get(key);
    if (!ret) {
      const { operations, params } = this.traverse(reqs as string[], new Set(precomputed));
      const rset = new Set(reqs);
      ret = { intermediates: [ ...operations.filter(v => !rset.has(v)) ], params };
      this.req_cache.set(key, ret);
    }
    return ret;
  }

  public loadSource(source: string | SerializedFn) {
    if (typeof source === 'string') {
      source = JSON.parse(source) as SerializedFn;
    }

    const { formulas: required_formulas, params, returns, isAsync, body } = source;
    const { deps } = this;

    const formulas: { [key: string]: Function } = {};
    for (const [k, v] of Object.entries(required_formulas)) {
      formulas[v] = deps.get(k)!.fn;
    }

    const calculator = new (isAsync ? AsyncFunction : Function)("formulas", "args", body);

    // tslint:disable-next-line no-shadowed-variable
    const fn = (function(f: Function, formulas: { [key: string]: Function }, args: { [key: string]: unknown }) {
      const missing = params.filter((p) => !args.hasOwnProperty(p));
      if (missing.length) {
        const uncalculable = [ ...reverseDependencies(deps.values(), new Set(missing)) ];
        throw new Error(`Missing arguments: Calculating [${ uncalculable.join(", ") }] requires [${ missing.join(", ") }] as input`);
      }

      return f(formulas, args);
    }).bind(null, calculator, formulas);

    const rkey = returns.sort().join('\0');
    const pkey = params.sort().join('\0');
    let pcache = this.fn_cache.get(rkey);
    if (!pcache) {
      pcache = new Map();
      this.fn_cache.set(rkey, pcache);
    }
    pcache.set(pkey, fn);
    return fn;
  }

  public compile(reqs: Iterable<string>, precomputed: Iterable<string> = []): [Function, SerializedFn] {
    const pre = [ ...precomputed ].sort();
    const returns = [ ...reqs ].sort();

    // Get the linearized operation list
    // and set of required parameters to
    // compute the requested values.
    const { blocks, params, intermediates } = this.linearize(returns, pre);
    const key = `${returns.join('\0')}\0\0${pre.join('\0')}`;
    this.req_cache.set(key, { intermediates: [ ...intermediates ], params });

    // Generate maps from arbitrary API value names to valid JS identifiers

    const pids: { [key: string]: string} = {};
    let count = 0;
    for (const param of params) {
      pids[param] = `v${ count++ }`;
    }

    let isAsync = false;
    const vids: { [key: string]: string} = {};
    for (const [a_block, s_block] of blocks) {
      for (const { outputs } of a_block) {
        vids[outputs] = `v${ count++ }`;
        isAsync = true;
      }
      for (const { outputs } of s_block) {
        vids[outputs] = `v${ count++ }`;
      }
    }

    const ids = { ...pids, ...vids };

    /* Assemble the function body */

    // Destructure arguments
    const destructure = Object.entries(pids).map(([ key, value ]) => `'${key}':${ value }`).join(", ");

    const calcs: string[] = [];

    const synth_call = (output: string, params: string[]) =>
      `formulas.${vids[output]}(${ params.map((p) => ids[p]).join(",") })`;

    const sync_block = (block: OpSpec[]) => {
      for (const { outputs, inputs } of block) {
        calcs.push(`const ${vids[outputs]} = ${ synth_call(outputs, inputs) };`);
      }
    };

    const async_block = (block: OpSpec[]) => {
      if (block.length === 1) {
        const { outputs, inputs } = block[0];
        calcs.push(`const ${vids[outputs]} = await ${ synth_call(outputs, inputs) };`);
      } else {
        const outlist = block.map(o => vids[o.outputs]).join(',');
        const exprlist = block.map(o => synth_call(o.outputs, o.inputs)).join(',');
        calcs.push(`const [${outlist}] = await Promise.all([${exprlist}]);`);
      }
    };

    let promises = 0;
    const mixed_block = (a_block: OpSpec[], s_block: OpSpec[]) => {
      if (a_block.length === 1) {
        const { outputs, inputs } = a_block[0];
        calcs.push(`const a${promises++} = ${ synth_call(outputs, inputs) };`);
        sync_block(s_block);
        calcs.push(`const ${vids[outputs]} = await a${promises};`);
      } else {
        const outlist = a_block.map(o => vids[o.outputs]).join(',');
        const exprlist = a_block.map(o => synth_call(o.outputs, o.inputs)).join(',');
        calcs.push(`const a${promises++} = Promise.all([${exprlist}]);`);
        sync_block(s_block);
        calcs.push(`const [${outlist}] = await ${promises};`);
      }
    };
    
    if (isAsync) {
      for (const [a_block, s_block] of blocks) {
        if (a_block.length) {
          if (s_block.length) { mixed_block(a_block, s_block); }
          else { async_block(a_block); }
        } else {
          sync_block(s_block);
        }
      }
    } else {
      for (const [, s_block] of blocks) {
        sync_block(s_block);
      }
    }

    const retmap = returns.map((v) => `'${ v }':${ ids[v] }`);

    const source: SerializedFn = {
      isAsync, params, returns,
      formulas: vids,
      body: `const {${ destructure }} = args;\n${ calcs.join("\n") }\nreturn {${ retmap.join(",") }};`,
    };

    return [this.loadSource(source), source];
  }

  public getCalculator(reqs: Iterable<string>, precomputed: Iterable<string> = []) {
    const returns = [ ...reqs ];
    const pre = [ ...precomputed ];
    const { fn_cache } = this;

    const rkey = returns.sort().join("\0");
    const pcache = fn_cache.get(rkey);
    if (!pcache) { // no cache, so we need to compile
      const [f] = this.compile(returns, pre);
      return f;
    }
    
    const { params } = this.getParams(returns, pre);
    const pkey = params.join('\0');

    let f = pcache.get(pkey);
    if (!f) { // only suboptimal versions cached, so we need to compile
      [f] = this.compile(returns, pre);
    }
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
        if ((e as any).missing) {
          throw new Error(`Cannot calculate [${ val }]; missing required input [${ (e as any).missing }].`);
        }

        throw e;
      }
    }

    return ret;
  }

  // Traverse the dependency DAG encoded in the formal
  // parameters of each formula, starting from the values
  // requested, and emitting calculations, in order to
  // determine the complete sets of required inputs
  // and intermediate calculations.
  private traverse(reqs: string[], precomp: Set<string>)  {
    const visited = new Set<string>();
    const operations = [];
    const params = [];
    const stack = [ ...reqs ];
    
    const { deps } = this;
    while (stack.length) {
      const val = stack.pop()!;
      if (visited.has(val)) { continue; }
      visited.add(val);

      const op = deps.get(val);
      if (!op || precomp.has(val)) {
        params.push(val);
        continue;
      }

      operations.push(val);
      stack.push(...op.inputs);
    }

    params.sort();
    return { operations, params };
  }

  // Linearize the the dependency DAG encoded in the
  // formal parameters of each formula and rooted at
  // the requested values, grouping operations into
  // blocks of synchronous and sync operations that
  // can be performed concurrently.
  private linearize(reqs: string[], precomputed: Iterable<string> = []) {
    const computed = new Set<string>(precomputed);
    const { params, operations } = this.traverse(reqs, computed);
    for (const v of params) { computed.add(v); }

    const { deps } = this;

    // Copy OpSpecs so that we can mutate them.
    let nodes = operations.map(v => {
      const { inputs, outputs, async } = deps.get(v)!;
      return { inputs: inputs, outputs, async: !!async };
    });

    const blocks: [OpSpec[], OpSpec[]][] = [];
    while (nodes.length) {
      const a_block: OpSpec[] = [];
      const s_block: OpSpec[] = [];
      const n_nodes: typeof nodes = [];
      for (const node of nodes) {
        // Split the remaining nodes into nodes that can't be
        // evaluated yet, async nodes that can be evaluated now,
        // and synchronous nodes that can be evaluated now.
        node.inputs = node.inputs.filter(v => !computed.has(v));
        if (node.inputs.length) {
          n_nodes.push(node);
        } else {
          computed.add(node.outputs);
          if (node.async) {
            a_block.push(deps.get(node.outputs)!);
          } else {
            s_block.push(deps.get(node.outputs)!);
          }
        }
      }
      blocks.push([a_block, s_block]);
      nodes = n_nodes;
    }

    const rset = new Set(reqs);
    return { blocks, params, intermediates: [ ...operations.filter(v => !rset.has(v)) ] };
  }
}
