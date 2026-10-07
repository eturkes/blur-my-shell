#!/usr/bin/gjs -m
// St gives directly loaded extension styles higher priority than @imports.
// Keep upstream's component sources, but ship their rules in the entry sheet.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

if (ARGV.length !== 2)
    throw new Error('Usage: flatten-stylesheet.js INPUT OUTPUT');
const input = Gio.File.new_for_path(ARGV[0]);
const output = Gio.File.new_for_path(ARGV[1]);
const root = input.get_parent();
if (input.equal(output))
    throw new Error('Output must be a build artifact, not the source stylesheet');
const decoder = new TextDecoder();
const imported = new Set();
function flatten(file, stack = new Set()) {
    const path = root.get_relative_path(file);
    if (path === null || path.startsWith('../'))
        throw new Error('Stylesheet import escapes the source directory');
    const uri = file.get_uri();
    if (stack.has(uri))
        throw new Error(`Cyclic stylesheet import: ${path}`);
    const next = new Set(stack);
    next.add(uri);
    const [, bytes] = file.load_contents(null);
    const text = decoder.decode(bytes);
    return text.split('\n').map(line => {
        const match = line.match(/^\s*@import\s+(?:url\(\s*(["'])([^"']+)\1\s*\)|(["'])([^"']+)\3)\s*;\s*$/);
        if (match) {
            const name = match[2] ?? match[4];
            if (/^(?:[a-z]+:|\/)/i.test(name))
                throw new Error(`Only local stylesheet imports can be bundled: ${name}`);
            const child = file.get_parent().resolve_relative_path(name);
            const childPath = root.get_relative_path(child);
            imported.add(childPath);
            return `\n/* Source: ${childPath} */\n${flatten(child, next)}\n`;
        }
        if (/^\s*@import\b/.test(line))
            throw new Error(`Unsupported import syntax in ${path}: ${line}`);
        // Fail closed if upstream introduces relative assets: flattening would
        // otherwise resolve them from the wrong directory. Review/rebase first.
        for (const url of line.matchAll(/url\(\s*(?:(["'])(.*?)\1|([^)]*))\s*\)/g)) {
            const value = (url[2] ?? url[3]).trim();
            if (!/^(?:[a-z]+:|\/|#)/i.test(value))
                throw new Error(`Relative asset URL needs rebasing in ${path}: ${value}`);
        }
        return line;
    }).join('\n');
}
const css = '/* Generated from src/stylesheet.css; edit component sources, not this bundle. */\n' + flatten(input);
GLib.file_set_contents(output.get_path(), css);
print(`Bundled ${imported.size} component stylesheets`);
