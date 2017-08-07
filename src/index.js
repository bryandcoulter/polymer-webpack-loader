import url from 'url';
import { getAttribute, remove, removeFakeRootElements } from 'dom5';
import loaderUtils from 'loader-utils';
import { minify } from 'html-minifier';
import parse5 from 'parse5';
// import espree from 'espree';
// import sourceMap from 'source-map';
/* eslint class-methods-use-this: ["error", { "exceptMethods": ["scripts"] }] */
class ProcessHtml {
  constructor(content, loader) {
    this.content = content;
    this.options = loaderUtils.getOptions(loader) || {};
    this.currentFilePath = loader.resourcePath;
  }
  /**
   * Process `<link>` tags, `<dom-module>` elements, and any `<script>`'s.
   * Return transformed content as a bundle for webpack.
   */
  process() {
    const doc = parse5.parse(this.content, { locationInfo: true });
    removeFakeRootElements(doc);
    const linksArray = [];
    const domModuleArray = [];
    const scriptsArray = [];
    const toBodyArray = [];
    for (let x = 0; x < doc.childNodes.length; x++) {
      const childNode = doc.childNodes[x];
      if (childNode.tagName) {
        if (childNode.tagName === 'dom-module') {
          const domModuleChildNodes = childNode.childNodes;
          for (let y = 0; y < domModuleChildNodes.length; y++) {
            if (domModuleChildNodes[y].tagName === 'script') {
              if (!ProcessHtml.isExternalPath(domModuleChildNodes[y], 'src')) {
                scriptsArray.push(domModuleChildNodes[y]);
              }
            }
          }
          domModuleArray.push(childNode);
        } else if (childNode.tagName === 'link') {
          if (!ProcessHtml.isExternalPath(childNode, 'href')) {
            linksArray.push(childNode);
          } else {
            toBodyArray.push(childNode);
          }
        } else if (childNode.tagName === 'script') {
          if (!ProcessHtml.isExternalPath(childNode, 'src')) {
            scriptsArray.push(childNode);
          } else {
            toBodyArray.push(childNode);
          }
        } else {
          toBodyArray.push(childNode);
        }
      }
    }


    const links = this.links(linksArray);
    const scripts = this.scripts(scriptsArray);
    const toBody = ProcessHtml.buildRuntimeSource(toBodyArray, 'toBody');

    scriptsArray.forEach((scriptNode) => {
      remove(scriptNode);
    });
    const domModules = ProcessHtml.buildRuntimeSource(domModuleArray, 'register');
    const addRegisterImport = (toBodyArray.length > 0 || domModuleArray.length > 0) ? '\nconst RegisterHtmlTemplate = require(\'polymer-webpack-loader/register-html-template\');\n' : '';

    const source = links.source + addRegisterImport + domModules.source + toBody.source + scripts.source;
    const sourceMap = '';
    return { source, sourceMap };
  }


  links(links) {
    let source = '';
    const ignoreLinks = this.options.ignoreLinks || [];
    const ignoreLinksFromPartialMatches = this.options.ignoreLinksFromPartialMatches || [];
    const ignorePathReWrites = this.options.ignorePathReWrite || [];
    let lineCount = 0;
    links.forEach((linkNode) => {
      const href = getAttribute(linkNode, 'href') || '';
      let path = '';
      if (href) {
        const checkIgnorePaths = ignorePathReWrites.filter(ignorePath => href.indexOf(ignorePath) >= 0);
        if (checkIgnorePaths.length === 0) {
          path = ProcessHtml.checkPath(href);
        } else {
          path = href;
        }

        const ignoredFromPartial = ignoreLinksFromPartialMatches.filter(partial => href.indexOf(partial) >= 0);
        if (ignoreLinks.indexOf(href) < 0 && ignoredFromPartial.length === 0) {
          source += `\nimport '${path}';\n`;
          lineCount += 2;
        }
      }
    });
    return {
      source,
      lineCount,
    };
  }

  scripts(scripts) {
    // const sourceMapGenerator = null;
    let lineCount = 0;
    let source = '';
    scripts.forEach((scriptNode) => {
      const src = getAttribute(scriptNode, 'src') || '';
      if (src) {
        const path = ProcessHtml.checkPath(src);
        source += `\nimport '${path}';\n`;
        lineCount += 2;
      } else {
        const scriptContents = parse5.serialize(scriptNode);
        /*
        sourceMapGenerator = sourceMapGenerator || new sourceMap.SourceMapGenerator();
        const tokens = espree.tokenize(scriptContents, {
          loc: true,
          ecmaVersion: 2017,
          sourceType: 'module',
        });

        // For script node content tokens, we need to offset the token position by the
        // line number of the script tag itself. And for the first line, offset the start
        // column to account for the <script> tag itself.
        const currentScriptLineOffset = scriptNode.childNodes[0].__location.line - 1; // eslint-disable-line no-underscore-dangle
        const firstLineCharOffset = scriptNode.childNodes[0].__location.col; // eslint-disable-line no-underscore-dangle
        tokens.forEach((token) => {
          if (!token.loc) {
            return;
          }
          const mapping = {
            original: {
              line: token.loc.start.line + currentScriptLineOffset,
              column: token.loc.start.column + (token.loc.start.line === 1 ? firstLineCharOffset : 0),
            },
            generated: {
              line: token.loc.start.line + lineCount,
              column: token.loc.start.column,
            },
            source: this.currentFilePath,
          };

          if (token.type === 'Identifier') {
            mapping.name = token.value;
          }

          sourceMapGenerator.addMapping(mapping);
        });
        */
        source += `\n${scriptContents}\n`;
        // eslint-disable-next-line no-underscore-dangle
        lineCount += 2 + (scriptNode.__location.endTag.line - scriptNode.__location.startTag.line);
      }
    });
    return {
      source,
      lineCount,
    };
  }

  static buildRuntimeSource(nodes, type) {
    let lineCount = 0;
    let source = '';
    nodes.forEach((node) => {
      const parseObject = {
        childNodes: [node],
      };

      const minimized = minify(parse5.serialize(parseObject), {
        collapseWhitespace: true,
        conservativeCollapse: true,
        minifyCSS: true,
        removeComments: true,
      });

      source += `
RegisterHtmlTemplate.${type}(${JSON.stringify(minimized)});
`;
      lineCount += 2;
    });

    return {
      source,
      lineCount,
    };
  }

  static isExternalPath(node, pathType) {
    const path = getAttribute(node, pathType) || '';
    const parseLink = url.parse(path);
    return parseLink.protocol || parseLink.slashes;
  }

  static checkPath(path) {
    const needsAdjusted = /^[A-Za-z]{1}/.test(path);
    return needsAdjusted ? `./${path}` : path;
  }


  /**
   * Look for all `<link>` elements and turn them into `import` statements.
   * e.g.
   * ```
   * <link rel="import" href="paper-input/paper-input.html">
   * becomes:
   * import 'paper-input/paper-input.html';
   * ```
   * @return {{source: string, lineCount: number}}
   */
}

// eslint-disable-next-line no-unused-vars
export default function entry(content, map) {
  const results = new ProcessHtml(content, this).process();
  this.callback(null, results.source, results.sourceMap);
}
