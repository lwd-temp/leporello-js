import {find_error_origin_node} from '../src/ast_utils.js'
import {parse, print_debug_node, load_modules} from '../src/parse_js.js'
import {eval_modules} from '../src/eval.js'
import {active_frame, pp_calltree} from '../src/calltree.js'
import {COMMANDS} from '../src/cmd.js'

Object.assign(globalThis, 
  {
    // for convenince, to type just `log` instead of `console.log`
    log: console.log,

    // For test env, set globalThis.run_window to just globalThis
    run_window: globalThis,
  }
)

export const patch_builtin = new Function(`
  let originals = globalThis.run_window.__builtins_originals
  let patched = globalThis.run_window.__builtins_patched
  if(originals == null) {
    globalThis.run_window.__original_setTimeout = globalThis.setTimeout
    // This code can execute twice when tests are run in self-hosted mode.
    // Ensure that patches will be applied only once
    originals = globalThis.run_window.__builtins_originals = {}
    patched = globalThis.run_window.__builtins_patched = {}

    const patch = (obj, name) => {
      originals[name] = obj[name]
      obj[name] = (...args) => {
        return patched[name] == null
        ? originals[name].apply(null, args)
        : patched[name].apply(null, args)
      }
    }

    // Substitute some builtin functions: fetch, setTimeout, Math.random to be
    // able to patch them in tests
    patch(globalThis.run_window, 'fetch')
    patch(globalThis.run_window, 'setTimeout')
    patch(globalThis.run_window.Math, 'random')
  }

  return (name, fn) => {
    patched[name] = fn
  }
`)()

export const original_setTimeout = globalThis.run_window.__original_setTimeout

export const do_parse = code => parse(
  code, 
  new Set(Object.getOwnPropertyNames(globalThis.run_window))
)

export const parse_modules = (entry, modules) => 
  load_modules(
    entry, 
    module_name => modules[module_name],
    new Set(Object.getOwnPropertyNames(globalThis.run_window))
  )

export const eval_tree = code => {
  const parse_result = do_parse(code)
  assert_equal(parse_result.ok, true)
  return eval_modules(
    {
      modules: {'': parse_result.node}, 
      sorted: ['']
    }
  ).calltree
}

export const assert_code_evals_to = (codestring, expected) => {
  const s = test_initial_state(codestring)
  const frame = active_frame(s)
  const result = frame.children.at(-1).result
  assert_equal(result.ok, true)
  assert_equal(result.value, expected)
  return frame
}

export const assert_code_error = (codestring, error) => {
  const state = test_initial_state(codestring)
  const frame = active_frame(state)
  assert_equal(frame.result.ok, false)
  assert_equal(find_error_origin_node(frame).result.error, error)
}

export const assert_code_evals_to_async = async (codestring, expected) => {
  const s = await test_initial_state_async(codestring)
  const frame = active_frame(s)
  const result = frame.children.at(-1).result
  assert_equal(result.ok, true)
  assert_equal(result.value, expected)
}

export const assert_code_error_async = async (codestring, error) => {
  const s = await test_initial_state_async(codestring)
  const frame = active_frame(s)
  const result = frame.children[frame.children.length - 1].result
  assert_equal(result.ok, false)
  assert_equal(result.error, error)
}

export const test_initial_state = (code, entrypoint_settings, other) => {
  return COMMANDS.open_run_window(
    COMMANDS.get_initial_state(
      {
        files: typeof(code) == 'object' ? code : { '' : code},
        ...other
      },
      {
        entrypoint: '',
        current_module: '',
        ...entrypoint_settings,
      }
    ),
    new Set(Object.getOwnPropertyNames(globalThis.run_window))
  )
}

export const test_initial_state_async = async code => {
  const s = test_initial_state(code)
  assert_equal(s.eval_modules_state != null, true)
  const result = await s.eval_modules_state.promise
  return COMMANDS.eval_modules_finished(
    s, 
    s,
    result, 
    s.eval_modules_state.node, 
    s.eval_modules_state.toplevel
  )
}

export const command_input_async = async (...args) => {
  const after_input = COMMANDS.input(...args).state
  const result = await after_input.eval_modules_state.promise
  return COMMANDS.eval_modules_finished(
    after_input, 
    after_input,
    result, 
    after_input.eval_modules_state.node, 
    after_input.eval_modules_state.toplevel
  )
}

export const test_deferred_calls_state = code => {
  const {get_deferred_call, on_deferred_call} = (new Function(`
    let args
    return {
      get_deferred_call() {
        return args
      },
      on_deferred_call(..._args) {
        args = _args
      }
    }
  `))()

  const state = test_initial_state(code, null, { on_deferred_call })

  return {
    state, 
    get_deferred_call, 
    on_deferred_call: state => COMMANDS.on_deferred_call(state, ...get_deferred_call())
  }
}

export const stringify = val => 
  JSON.stringify(val, (key, value) => {
    if(value instanceof Set){
      return [...value]
    } else if(value instanceof Error) {
      return {message: value.message}
    } else {
      return value
    }
  }, 2)

export const assert_equal = (exp, actual) => {
  if(typeof(exp) == 'object' && typeof(actual) == 'object'){
    const exp_json = stringify(exp)
    const act_json = stringify(actual)
    if(exp_json != act_json){
      throw new Error(`FAIL: ${exp_json} != ${act_json}`)
    }
  } else {
    if(exp != actual){
      throw new Error(`FAIL: ${exp} != ${actual}`)
    } 
  }
}

export const print_debug_ct_node = node => {
  const do_print = node => {
    const {id, fn, ok, value, error, args, has_more_children} = node
    const res = {id, fn: fn?.name, ok, value, error, args, has_more_children}
    if(node.children == null) {
      return res
    } else {
      const next_children = node.children.map(do_print)
      return {...res, children: next_children}
    }
  }
  return stringify(do_print(node))
}

export const test = (message, test, only = false) => {
  return {
    message, 
    test: Object.defineProperty(test, 'name', {value: message}),
    only,
  }
}

export const test_only = (message, t) => test(message, t, true)

// Wrap to Function constructor to hide from calltree view
// TODO in calltree view, hide fn which has special flag set (see
// filter_calltree)

export const run = Object.defineProperty(new Function('tests', `
    // Runs test, return failure or null if not failed
    const run_test = t => {
      return Promise.resolve().then(t.test)
        .then(() => null)
        .catch(e => {
          if(globalThis.process != null) {
            // In node.js runner, fail fast
            console.error('Failed: ' + t.message)
            throw e
          } else {
            return e
          }
        })
    }

    // If not run in node, then dont apply filter
    const filter = globalThis.process && globalThis.process.argv[2]

    if(filter == null) {

      const only = tests.find(t => t.only)
      const tests_to_run = only == null ? tests : [only]

      // Exec each test. After all tests are done, we rethrow first error if
      // any. So we will mark root calltree node if one of tests failed
      return tests_to_run.reduce(
        (failureP, t) => 
          Promise.resolve(failureP).then(failure => 
            run_test(t).then(next_failure => failure ?? next_failure)
          )
        ,
        null
      ).then(failure => {

        if(failure != null) {
          throw failure
        } else {
          if(globalThis.process != null) {
            console.log('Ok')
          }
        }

      })

    } else {
      const test = tests.find(t => t.message.includes(filter))
      if(test == null) {
        throw new Error('test not found')
      } else {
        return run_test(test).then(() => {
          if(globalThis.process != null) {
            console.log('Ok')
          }
        })
      }
    }
`), 'name', {value: 'run'})
