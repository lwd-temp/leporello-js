import {el} from './domutils.js'
import {map_find} from '../utils.js'
import {open_dir, create_file} from '../filesystem.js'
import {
  exec, 
  get_state, 
  open_directory, 
  reload_run_window,
  close_directory,
} from '../index.js'

const is_html = path => path.endsWith('.htm') || path.endsWith('.html')
const is_js = path => path == '' || path.endsWith('.js') || path.endsWith('.mjs')

export class Files {
  constructor(ui) {
    this.ui = ui
    this.el =  el('div', 'files_container')
    this.render(get_state())
  }

  change_entrypoint(e) {
    const file = e.target.value
    exec('change_entrypoint', file)
    this.ui.editor.focus()
  }

  change_html_file(e) {
    const html_file = e.target.value
    exec('change_html_file', html_file)
    reload_run_window(get_state())
  }


  render(state) {
    const file_actions = state.has_file_system_access
      ? el('div', 'file_actions',
          el('a', {
            'class': 'file_action',
            href: 'javascript: void(0)', 
            click: this.create_file.bind(this, false),
          }, 
            'New file'
          ),

          el('a', {
            'class': 'file_action',
            href: 'javascript: void(0)',
            click: this.create_file.bind(this, true),
          }, 
            'New dir'
          ),

          el('a', {
            'class': 'file_action',
            href: 'javascript: void(0)',
            click: close_directory,
          }, 
            'Revoke access'
          ),

          el('a', {
            href: 'https://github.com/leporello-js/leporello-js#selecting-entrypoint-module',
            target: '__blank',
            "class": 'select_entrypoint_title',
            title: 'Select entrypoint',
          }, 
            'Entry point'
          ),
      )
      : el('div', 'file_actions',
          el('div', 'file_action allow_file_access',
            el('a', {
              href: 'javascript: void(0)',
              click: open_directory,
            }, 'Allow access to local project folder'),
            el('span', 'subtitle', `Your files will never leave your device`)
          ),
        )



    const file_elements = [
      this.render_file({name: '*scratch*', path: ''}, state),
      this.render_file(state.project_dir, state),
    ]

    const files = this.el.querySelector('.files')

    if(files == null) {
      this.el.innerHTML = ''
      this.el.appendChild(file_actions)
      this.el.appendChild(
        el('div', 'files', file_elements)
      )
    } else {
      // Replace to preserve scroll position
      this.el.replaceChild(file_actions, this.el.children[0])
      files.replaceChildren(...file_elements)
    }
  }

  render_select_entrypoint(file, state) {
    if(!state.has_file_system_access || file.kind == 'directory') {
      return null
    } else if(is_js(file.path)) {
      return el('span', 'select_entrypoint',
        el('input', {
          type: 'radio', 
          name: 'js_entrypoint', 
          value: file.path,
          checked: state.entrypoint == file.path,
          change: e => this.change_entrypoint(e),
          click: e => e.stopPropagation(),
        })
      )
    } else if(is_html(file.path)) {
      return el('span', 'select_entrypoint',
        el('input', {
          type: 'radio', 
          name: 'html_file', 
          value: file.path,
          checked: state.html_file == file.path,
          change: e => this.change_html_file(e),
          click: e => e.stopPropagation(),
        })
      )
    } else {
      return null
    }
  }

  render_file(file, state) {
    const result =  el('div', 'file',
      el('div', {
          'class': 'file_title' + (file.path == state.current_module ? ' active' : ''), 
          click: e => this.on_click(e, file)
        }, 
        el('span', 'icon',
          file.kind == 'directory'
            ? '\u{1F4C1}' // folder icon
            : '\xa0',
        ),
        file.name, 
        this.render_select_entrypoint(file, state),
      ),
      file.children == null 
        ? null
        : file.children.map(c => this.render_file(c, state))
    )

    if(file.path == state.current_module) {
      this.active_el = result
      this.active_file = file
    }

    return result
  }

  async create_file(is_dir) {

    if(this.active_file == null) {
      throw new Error('no active file')
    }

    let name = prompt(`Enter ${is_dir ? 'directory' : 'file'} name`)
    if(name == null) {
      return
    }

    let dir

    const root = get_state().project_dir

    if(this.active_file.path == '' /* scratch */) {
      // Create in root directory
      dir = root
    } else {
      if(this.active_file.kind == 'directory') {
        dir = this.active_file
      } else {

        const find_parent = (dir, parent) => {
          if(dir.path == this.active_file.path) {
            return parent
          }
          if(dir.children == null) {
            return null
          }
          return map_find(dir.children, c => find_parent(c, dir))
        }

        dir = find_parent(root)

        if(dir == null) {
          throw new Error('illegal state')
        }
      }
    }

    const path = dir == root ? name : dir.path + '/' + name
    await create_file(path, is_dir)

    // Reload all files for simplicity
    open_dir(false).then(dir => {
      if(is_dir) {
        exec('load_dir', dir, true)
      } else {
        exec('create_file', dir, path)
      }
    })
  }


  on_click(e, file) {
    e.stopPropagation()
    this.active_el.querySelector('.file_title').classList.remove('active')
    this.active_el = e.currentTarget.parentElement
    e.currentTarget.classList.add('active')
    this.active_file = file

    if(file.kind != 'directory') {
      if(get_state().has_file_system_access) {
        exec('change_current_module', file.path)
      } else {
        // in examples mode, on click file we also change entrypoint for
        // simplicity
        exec('change_entrypoint', file.path)
      }
    }
  }
}
