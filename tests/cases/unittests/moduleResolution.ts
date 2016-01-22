/// <reference path="..\..\..\src\harness\external\mocha.d.ts" />
/// <reference path='..\..\..\src\harness\harness.ts' />

declare namespace chai.assert {
    function deepEqual(actual: any, expected: any): void;
}

module ts {
    function diagnosticToString(diagnostic: Diagnostic) {
        let output = "";

        if (diagnostic.file) {
            let loc = getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start);

            output += `${diagnostic.file.fileName}(${loc.line + 1},${loc.character + 1}): `;
        }

        let category = DiagnosticCategory[diagnostic.category].toLowerCase();
        output += `${category} TS${diagnostic.code}: ${flattenDiagnosticMessageText(diagnostic.messageText, sys.newLine)}${sys.newLine}`;

        return output;
    }

    interface File {
        name: string
        content?: string
    }

    function createModuleResolutionHost(hasDirectoryExists: boolean, ...files: File[]): ModuleResolutionHost {
        let map = arrayToMap(files, f => f.name);

        if (hasDirectoryExists) {
            const directories: Map<string> = {};
            for (const f of files) {
                let name = getDirectoryPath(f.name);
                while (true) {
                    directories[name] = name;
                    let baseName = getDirectoryPath(name);
                    if (baseName === name) {
                        break;
                    }
                    name = baseName;
                }
            }
            return {
                readFile,
                directoryExists: path => { 
                    return hasProperty(directories, path); 
                },
                fileExists: path => {
                    assert.isTrue(hasProperty(directories, getDirectoryPath(path)), "'fileExists' request in non-existing directory");
                    return hasProperty(map, path);
                }
            }
        }
        else {
            return { readFile, fileExists: path => hasProperty(map, path), };
        }
        function readFile(path: string): string {
            return hasProperty(map, path) ? map[path].content : undefined;
        }
    }

    function splitPath(path: string): { dir: string; rel: string } {
        let index = path.indexOf(directorySeparator);
        return index === -1
            ? { dir: path, rel: undefined }
            : { dir: path.substr(0, index), rel: path.substr(index + 1) };
    }

    describe("Node module resolution - relative paths", () => {

        function testLoadAsFile(containingFileName: string, moduleFileNameNoExt: string, moduleName: string): void {
            for (let ext of supportedTypeScriptExtensions) {
                test(ext, /*hasDirectoryExists*/ false);
                test(ext, /*hasDirectoryExists*/ true);
            }

            function test(ext: string, hasDirectoryExists: boolean) {
                let containingFile = { name: containingFileName }
                let moduleFile = { name: moduleFileNameNoExt + ext }
                let resolution = nodeModuleNameResolver(moduleName, containingFile.name, {}, createModuleResolutionHost(hasDirectoryExists, containingFile, moduleFile));
                assert.equal(resolution.resolvedModule.resolvedFileName, moduleFile.name);
                assert.equal(!!resolution.resolvedModule.isExternalLibraryImport, false);

                let failedLookupLocations: string[] = [];
                let dir = getDirectoryPath(containingFileName);
                for (let e of supportedTypeScriptExtensions) {
                    if (e === ext) {
                        break;
                    }
                    else {
                        failedLookupLocations.push(normalizePath(getRootLength(moduleName) === 0 ? combinePaths(dir, moduleName) : moduleName) + e);
                    }
                }

                assert.deepEqual(resolution.failedLookupLocations, failedLookupLocations);

            }
        }

        it("module name that starts with './' resolved as relative file name", () => {
            testLoadAsFile("/foo/bar/baz.ts", "/foo/bar/foo", "./foo");
        });

        it("module name that starts with '../' resolved as relative file name", () => {
            testLoadAsFile("/foo/bar/baz.ts", "/foo/foo", "../foo");
        });

        it("module name that starts with '/' script extension resolved as relative file name", () => {
            testLoadAsFile("/foo/bar/baz.ts", "/foo", "/foo");
        });

        it("module name that starts with 'c:/' script extension resolved as relative file name", () => {
            testLoadAsFile("c:/foo/bar/baz.ts", "c:/foo", "c:/foo");
        });

        function testLoadingFromPackageJson(containingFileName: string, packageJsonFileName: string, fieldRef: string, moduleFileName: string, moduleName: string): void {
            test(/*hasDirectoryExists*/ false);
            test(/*hasDirectoryExists*/ true);

            function test(hasDirectoryExists: boolean) {
                let containingFile = { name: containingFileName };
                let packageJson = { name: packageJsonFileName, content: JSON.stringify({ "typings": fieldRef }) };
                let moduleFile = { name: moduleFileName };
                let resolution = nodeModuleNameResolver(moduleName, containingFile.name, {}, createModuleResolutionHost(hasDirectoryExists, containingFile, packageJson, moduleFile));
                assert.equal(resolution.resolvedModule.resolvedFileName, moduleFile.name);
                assert.equal(!!resolution.resolvedModule.isExternalLibraryImport, false);
                // expect three failed lookup location - attempt to load module as file with all supported extensions
                assert.equal(resolution.failedLookupLocations.length, supportedTypeScriptExtensions.length);
            }
        }

        it("module name as directory - load from 'typings'", () => {
            testLoadingFromPackageJson("/a/b/c/d.ts", "/a/b/c/bar/package.json", "c/d/e.d.ts", "/a/b/c/bar/c/d/e.d.ts", "./bar");
            testLoadingFromPackageJson("/a/b/c/d.ts", "/a/bar/package.json", "e.d.ts", "/a/bar/e.d.ts", "../../bar");
            testLoadingFromPackageJson("/a/b/c/d.ts", "/bar/package.json", "e.d.ts", "/bar/e.d.ts", "/bar");
            testLoadingFromPackageJson("c:/a/b/c/d.ts", "c:/bar/package.json", "e.d.ts", "c:/bar/e.d.ts", "c:/bar");
        });

        function testTypingsIgnored(typings: any): void {
            test(/*hasDirectoryExists*/ false);
            test(/*hasDirectoryExists*/ true);

            function test(hasDirectoryExists: boolean) {
                let containingFile = { name: "/a/b.ts" };
                let packageJson = { name: "/node_modules/b/package.json", content: JSON.stringify({ "typings": typings }) };
                let moduleFile = { name: "/a/b.d.ts" };

                let indexPath = "/node_modules/b/index.d.ts";
                let indexFile = { name: indexPath }

                let resolution = nodeModuleNameResolver("b", containingFile.name, {}, createModuleResolutionHost(hasDirectoryExists, containingFile, packageJson, moduleFile, indexFile));

                assert.equal(resolution.resolvedModule.resolvedFileName, indexPath);
            }
        }

        it("module name as directory - handle invalid 'typings'", () => {
            testTypingsIgnored(["a", "b"]);
            testTypingsIgnored({ "a": "b" });
            testTypingsIgnored(true);
            testTypingsIgnored(null);
            testTypingsIgnored(undefined);
        });

        it("module name as directory - load index.d.ts", () => {
            test(/*hasDirectoryExists*/ false);
            test(/*hasDirectoryExists*/ true);

            function test(hasDirectoryExists: boolean) {
                let containingFile = { name: "/a/b/c.ts" };
                let packageJson = { name: "/a/b/foo/package.json", content: JSON.stringify({ main: "/c/d" }) };
                let indexFile = { name: "/a/b/foo/index.d.ts" };
                let resolution = nodeModuleNameResolver("./foo", containingFile.name, {}, createModuleResolutionHost(hasDirectoryExists, containingFile, packageJson, indexFile));
                assert.equal(resolution.resolvedModule.resolvedFileName, indexFile.name);
                assert.equal(!!resolution.resolvedModule.isExternalLibraryImport, false);
                assert.deepEqual(resolution.failedLookupLocations, [
                    "/a/b/foo.ts",
                    "/a/b/foo.tsx",
                    "/a/b/foo.d.ts",
                    "/a/b/foo/index.ts",
                    "/a/b/foo/index.tsx",
                ]);
            }
        });
    });

    describe("Node module resolution - non-relative paths", () => {
        it("load module as file - ts files not loaded", () => {
            test(/*hasDirectoryExists*/ false);
            test(/*hasDirectoryExists*/ true);

            function test(hasDirectoryExists: boolean) {
                let containingFile = { name: "/a/b/c/d/e.ts" };
                let moduleFile = { name: "/a/b/node_modules/foo.ts" };
                let resolution = nodeModuleNameResolver("foo", containingFile.name, {}, createModuleResolutionHost(hasDirectoryExists, containingFile, moduleFile));
                assert.equal(resolution.resolvedModule.resolvedFileName, moduleFile.name);
                assert.deepEqual(resolution.failedLookupLocations, [
                    "/a/b/c/d/node_modules/foo.ts",
                    "/a/b/c/d/node_modules/foo.tsx",
                    "/a/b/c/d/node_modules/foo.d.ts",
                    "/a/b/c/d/node_modules/foo/package.json",
                    "/a/b/c/d/node_modules/foo/index.ts",
                    "/a/b/c/d/node_modules/foo/index.tsx",
                    "/a/b/c/d/node_modules/foo/index.d.ts",
                    "/a/b/c/node_modules/foo.ts",
                    "/a/b/c/node_modules/foo.tsx",
                    "/a/b/c/node_modules/foo.d.ts",
                    "/a/b/c/node_modules/foo/package.json",
                    "/a/b/c/node_modules/foo/index.ts",
                    "/a/b/c/node_modules/foo/index.tsx",
                    "/a/b/c/node_modules/foo/index.d.ts",
                ])
            }
        });

        it("load module as file", () => {
            test(/*hasDirectoryExists*/ false);
            test(/*hasDirectoryExists*/ true);

            function test(hasDirectoryExists: boolean) {
                let containingFile = { name: "/a/b/c/d/e.ts" };
                let moduleFile = { name: "/a/b/node_modules/foo.d.ts" };
                let resolution = nodeModuleNameResolver("foo", containingFile.name, {}, createModuleResolutionHost(hasDirectoryExists, containingFile, moduleFile));
                assert.equal(resolution.resolvedModule.resolvedFileName, moduleFile.name);
                assert.equal(resolution.resolvedModule.isExternalLibraryImport, true);
            }
        });

        it("load module as directory", () => {
            test(/*hasDirectoryExists*/ false);
            test(/*hasDirectoryExists*/ true);

            function test(hasDirectoryExists: boolean) {
                let containingFile = { name: "/a/node_modules/b/c/node_modules/d/e.ts" };
                let moduleFile = { name: "/a/node_modules/foo/index.d.ts" };
                let resolution = nodeModuleNameResolver("foo", containingFile.name, {}, createModuleResolutionHost(hasDirectoryExists, containingFile, moduleFile));
                assert.equal(resolution.resolvedModule.resolvedFileName, moduleFile.name);
                assert.equal(resolution.resolvedModule.isExternalLibraryImport, true);
                assert.deepEqual(resolution.failedLookupLocations, [
                    "/a/node_modules/b/c/node_modules/d/node_modules/foo.ts",
                    "/a/node_modules/b/c/node_modules/d/node_modules/foo.tsx",
                    "/a/node_modules/b/c/node_modules/d/node_modules/foo.d.ts",
                    "/a/node_modules/b/c/node_modules/d/node_modules/foo/package.json",
                    "/a/node_modules/b/c/node_modules/d/node_modules/foo/index.ts",
                    "/a/node_modules/b/c/node_modules/d/node_modules/foo/index.tsx",
                    "/a/node_modules/b/c/node_modules/d/node_modules/foo/index.d.ts",
                    "/a/node_modules/b/c/node_modules/foo.ts",
                    "/a/node_modules/b/c/node_modules/foo.tsx",
                    "/a/node_modules/b/c/node_modules/foo.d.ts",
                    "/a/node_modules/b/c/node_modules/foo/package.json",
                    "/a/node_modules/b/c/node_modules/foo/index.ts",
                    "/a/node_modules/b/c/node_modules/foo/index.tsx",
                    "/a/node_modules/b/c/node_modules/foo/index.d.ts",
                    "/a/node_modules/b/node_modules/foo.ts",
                    "/a/node_modules/b/node_modules/foo.tsx",
                    "/a/node_modules/b/node_modules/foo.d.ts",
                    "/a/node_modules/b/node_modules/foo/package.json",
                    "/a/node_modules/b/node_modules/foo/index.ts",
                    "/a/node_modules/b/node_modules/foo/index.tsx",
                    "/a/node_modules/b/node_modules/foo/index.d.ts",
                    "/a/node_modules/foo.ts",
                    "/a/node_modules/foo.tsx",
                    "/a/node_modules/foo.d.ts",
                    "/a/node_modules/foo/package.json",
                    "/a/node_modules/foo/index.ts",
                    "/a/node_modules/foo/index.tsx"
                ]);

            }
        });
    });

    describe("Module resolution - relative imports", () => {
        function test(files: Map<string>, currentDirectory: string, rootFiles: string[], expectedFilesCount: number, relativeNamesToCheck: string[]) {
            const options: CompilerOptions = { module: ModuleKind.CommonJS };
            const host: CompilerHost = {
                getSourceFile: (fileName: string, languageVersion: ScriptTarget) => {
                    let path = normalizePath(combinePaths(currentDirectory, fileName));
                    return hasProperty(files, path) ? createSourceFile(fileName, files[path], languageVersion) : undefined;
                },
                getDefaultLibFileName: () => "lib.d.ts",
                writeFile: (fileName, content): void => { throw new Error("NotImplemented"); },
                getCurrentDirectory: () => currentDirectory,
                getCanonicalFileName: fileName => fileName.toLowerCase(),
                getNewLine: () => "\r\n",
                useCaseSensitiveFileNames: () => false,
                fileExists: fileName => {
                    let path = normalizePath(combinePaths(currentDirectory, fileName));
                    return hasProperty(files, path);
                },
                readFile: (fileName): string => { throw new Error("NotImplemented"); }
            };

            const program = createProgram(rootFiles, options, host);

            assert.equal(program.getSourceFiles().length, expectedFilesCount);
            const syntacticDiagnostics = program.getSyntacticDiagnostics();
            assert.equal(syntacticDiagnostics.length, 0, `expect no syntactic diagnostics, got: ${JSON.stringify(syntacticDiagnostics.map(diagnosticToString))}`);
            const semanticDiagnostics = program.getSemanticDiagnostics();
            assert.equal(semanticDiagnostics.length, 0, `expect no semantic diagnostics, got: ${JSON.stringify(semanticDiagnostics.map(diagnosticToString))}`);

            // try to get file using a relative name
            for (const relativeFileName of relativeNamesToCheck) {
                assert.isTrue(program.getSourceFile(relativeFileName) !== undefined, `expected to get file by relative name, got undefined`);
            }
        }

        it("should find all modules", () => {
            const files: Map<string> = {
                "/a/b/c/first/shared.ts": `
class A {}
export = A`,
                "/a/b/c/first/second/class_a.ts": `
import Shared = require('../shared');
import C = require('../../third/class_c');
class B {}
export = B;`,
                "/a/b/c/third/class_c.ts": `
import Shared = require('../first/shared');
class C {}
export = C;
                `
            };
            test(files, "/a/b/c/first/second", ["class_a.ts"], 3, ["../../../c/third/class_c.ts"]);
        });
        
        it("should find modules in node_modules", () => {
            const files: Map<string> = {
                "/parent/node_modules/mod/index.d.ts": "export var x",
                "/parent/app/myapp.ts": `import {x} from "mod"`
            };
            test(files, "/parent/app",["myapp.ts"], 2, []);
        });

        it("should find file referenced via absolute and relative names", () => {
            const files: Map<string> = {
                "/a/b/c.ts": `/// <reference path="b.ts"/>`,
                "/a/b/b.ts": "var x"
            };
            test(files, "/a/b", ["c.ts", "/a/b/b.ts"], 2, []);
        });
    });
    
    describe("Files with different casing", () => {
        const library = createSourceFile("lib.d.ts", "", ScriptTarget.ES5);
        function test(files: Map<string>, options: CompilerOptions, currentDirectory: string, useCaseSensitiveFileNames: boolean, rootFiles: string[], diagnosticCodes: number[]): void {
            const getCanonicalFileName = createGetCanonicalFileName(useCaseSensitiveFileNames);
            if (!useCaseSensitiveFileNames) {
                let f: Map<string> = {};
                for (let fileName in files) {
                    f[getCanonicalFileName(fileName)] = files[fileName];
                }
                files = f;
            }

            const host: CompilerHost = {
                getSourceFile: (fileName: string, languageVersion: ScriptTarget) => {
                    if (fileName === "lib.d.ts") {
                        return library;
                    }
                    let path = getCanonicalFileName(normalizePath(combinePaths(currentDirectory, fileName)));
                    return hasProperty(files, path) ? createSourceFile(fileName, files[path], languageVersion) : undefined;
                },
                getDefaultLibFileName: () => "lib.d.ts",
                writeFile: (fileName, content): void => { throw new Error("NotImplemented"); },
                getCurrentDirectory: () => currentDirectory,
                getCanonicalFileName,
                getNewLine: () => "\r\n",
                useCaseSensitiveFileNames: () => useCaseSensitiveFileNames,
                fileExists: fileName => {
                    let path = getCanonicalFileName(normalizePath(combinePaths(currentDirectory, fileName)));
                    return hasProperty(files, path);
                },
                readFile: (fileName): string => { throw new Error("NotImplemented"); }
            };
            const program = createProgram(rootFiles, options, host);
            const diagnostics = sortAndDeduplicateDiagnostics(program.getSemanticDiagnostics().concat(program.getOptionsDiagnostics()));
            assert.equal(diagnostics.length, diagnosticCodes.length, `Incorrect number of expected diagnostics, expected ${diagnosticCodes.length}, got '${map(diagnostics, diagnosticToString).join("\r\n")}'`);
            for (let i = 0; i < diagnosticCodes.length; ++i) {
                assert.equal(diagnostics[i].code, diagnosticCodes[i], `Expected diagnostic code ${diagnosticCodes[i]}, got '${diagnostics[i].code}': '${diagnostics[i].messageText}'`);
            }
        }

        it("should succeed when the same file is referenced using absolute and relative names", () => {
            const files: Map<string> = {
                "/a/b/c.ts": `/// <reference path="d.ts"/>`,
                "/a/b/d.ts": "var x"
            };
            test(files, { module: ts.ModuleKind.AMD },  "/a/b", /* useCaseSensitiveFileNames */ false, ["c.ts", "/a/b/d.ts"], []);
        });

        it("should fail when two files used in program differ only in casing (tripleslash references)", () => {
            const files: Map<string> = {
                "/a/b/c.ts": `/// <reference path="D.ts"/>`,
                "/a/b/d.ts": "var x"
            };
            test(files, { module: ts.ModuleKind.AMD, forceConsistentCasingInFileNames: true },  "/a/b", /* useCaseSensitiveFileNames */ false, ["c.ts", "d.ts"], [1149]);
        });

        it("should fail when two files used in program differ only in casing (imports)", () => {
            const files: Map<string> = {
                "/a/b/c.ts": `import {x} from "D"`,
                "/a/b/d.ts": "export var x"
            };
            test(files, { module: ts.ModuleKind.AMD, forceConsistentCasingInFileNames: true },  "/a/b", /* useCaseSensitiveFileNames */ false, ["c.ts", "d.ts"], [1149]);
        });

        it("should fail when two files used in program differ only in casing (imports, relative module names)", () => {
            const files: Map<string> = {
                "moduleA.ts": `import {x} from "./ModuleB"`,
                "moduleB.ts": "export var x"
            };
            test(files, { module: ts.ModuleKind.CommonJS, forceConsistentCasingInFileNames: true },  "", /* useCaseSensitiveFileNames */ false, ["moduleA.ts", "moduleB.ts"], [1149]);
        });

        it("should fail when two files exist on disk that differs only in casing", () => {
            const files: Map<string> = {
                "/a/b/c.ts": `import {x} from "D"`,
                "/a/b/D.ts": "export var x",
                "/a/b/d.ts": "export var y"
            };
            test(files, { module: ts.ModuleKind.AMD },  "/a/b", /* useCaseSensitiveFileNames */ true, ["c.ts", "d.ts"], [1149]);
        });

        it("should fail when module name in 'require' calls has inconsistent casing", () => {
            const files: Map<string> = {
                "moduleA.ts": `import a = require("./ModuleC")`,
                "moduleB.ts": `import a = require("./moduleC")`,
                "moduleC.ts": "export var x"
            };
            test(files, { module: ts.ModuleKind.CommonJS, forceConsistentCasingInFileNames: true },  "", /* useCaseSensitiveFileNames */ false, ["moduleA.ts", "moduleB.ts", "moduleC.ts"], [1149, 1149]);
        });

        it("should fail when module names in 'require' calls has inconsistent casing and current directory has uppercase chars", () => {
            const files: Map<string> = {
                "/a/B/c/moduleA.ts": `import a = require("./ModuleC")`,
                "/a/B/c/moduleB.ts": `import a = require("./moduleC")`,
                "/a/B/c/moduleC.ts": "export var x",
                "/a/B/c/moduleD.ts": `
import a = require("./moduleA.ts");
import b = require("./moduleB.ts");
                `
            };
            test(files, { module: ts.ModuleKind.CommonJS, forceConsistentCasingInFileNames: true },  "/a/B/c", /* useCaseSensitiveFileNames */ false, ["moduleD.ts"], [1149]);
        });
        it("should not fail when module names in 'require' calls has consistent casing and current directory has uppercase chars", () => {
            const files: Map<string> = {
                "/a/B/c/moduleA.ts": `import a = require("./moduleC")`,
                "/a/B/c/moduleB.ts": `import a = require("./moduleC")`,
                "/a/B/c/moduleC.ts": "export var x",
                "/a/B/c/moduleD.ts": `
import a = require("./moduleA.ts");
import b = require("./moduleB.ts");
                `
            };
            test(files, { module: ts.ModuleKind.CommonJS, forceConsistentCasingInFileNames: true },  "/a/B/c", /* useCaseSensitiveFileNames */ false, ["moduleD.ts"], []);
        })
    });

    describe("baseUrl augmented module resolution", () => {
        it("module resolution without path mappings/rootDirs", () => {
            test(/*hasDirectoryExists*/ false);
            test(/*hasDirectoryExists*/ true);

            function test(hasDirectoryExists: boolean) {
                const file1: File = { name: "/root/folder1/file1.ts" };
                const file2: File = { name: "/root/folder2/file2.ts" };
                const file3: File = { name: "/root/folder2/file3.ts" };
                const host = createModuleResolutionHost(hasDirectoryExists, file1, file2, file3);
                for (const moduleResolution of [ ModuleResolutionKind.NodeJs, ModuleResolutionKind.Classic ]) {
                    const options: CompilerOptions = { moduleResolution, baseUrl: "/root" };
                    {
                        const result = resolveModuleName("folder2/file2", file1.name, options, host);
                        assert.isTrue(result.resolvedModule !== undefined, "module should be resolved");
                        assert.equal(result.resolvedModule.resolvedFileName, file2.name);
                        assert.deepEqual(result.failedLookupLocations, []);
                    }
                    {
                        const result = resolveModuleName("./file3", file2.name, options, host);
                        assert.isTrue(result.resolvedModule !== undefined, "module should be resolved");
                        assert.equal(result.resolvedModule.resolvedFileName, file3.name);
                        assert.deepEqual(result.failedLookupLocations, []);
                    }
                    {
                        const result = resolveModuleName(file1.name, file2.name, options, host);
                        assert.isTrue(result.resolvedModule !== undefined, "module should be resolved");
                        assert.equal(result.resolvedModule.resolvedFileName, file1.name);
                        assert.deepEqual(result.failedLookupLocations, []);
                    }
                }
            }
            // add failure tests
        });
        
        it("baseUrl + node", () => {
            test(/*hasDirectoryExists*/ false);
            test(/*hasDirectoryExists*/ true);

            function test(hasDirectoryExists: boolean) {
                const main: File = { name: "/root/a/b/main.ts" };
                const m1: File = { name: "/root/m1.ts" }; // load file as module
                const m2: File = { name: "/root/m2/index.d.ts" }; // load folder as module
                const m3: File = { name: "/root/m3/package.json", content: JSON.stringify({ typings: "dist/typings.d.ts" }) };
                const m3Typings: File = { name: "/root/m3/dist/typings.d.ts" }; 
                const m4: File = { name: "/root/node_modules/m4.ts" }; // fallback to node

                const options: CompilerOptions = { moduleResolution: ModuleResolutionKind.NodeJs, baseUrl: "/root" };
                const host = createModuleResolutionHost(hasDirectoryExists, main, m1, m2, m3, m3Typings, m4);

                check("m1", main, m1);
                check("m2", main, m2);
                check("m3", main, m3Typings);
                check("m4", main, m4);
                
                function check(name: string, caller: File, expected: File) {
                    const result = resolveModuleName(name, caller.name, options, host);
                    assert.isTrue(result.resolvedModule !== undefined);
                    assert.isTrue(result.resolvedModule.resolvedFileName, expected.name);
                }
            } 
        });

        it("baseUrl + classic", () => {
            test(/*hasDirectoryExists*/ false);
            test(/*hasDirectoryExists*/ true);

            function test(hasDirectoryExists: boolean) {
                const main: File = { name: "/root/a/b/main.ts" };
                const m1: File = { name: "/root/x/m1.ts" }; // load from base url
                const m2: File = { name: "/m2.ts" }; // fallback to classic

                const options: CompilerOptions = { moduleResolution: ModuleResolutionKind.Classic, baseUrl: "/root/x" };
                const host = createModuleResolutionHost(hasDirectoryExists, main, m1, m2);

                check("m1", main, m1);
                check("m2", main, m2);
                
                function check(name: string, caller: File, expected: File) {
                    const result = resolveModuleName(name, caller.name, options, host);
                    assert.isTrue(result.resolvedModule !== undefined);
                    assert.isTrue(result.resolvedModule.resolvedFileName, expected.name);
                }
            } 
        })

        it("module resolution with path mappings", () => {
            test(/*hasDirectoryExists*/ false);
            test(/*hasDirectoryExists*/ true);

            function test(hasDirectoryExists: boolean) {
                const file1: File = { name: "/root/folder1/file1.ts" };
                const file2: File = { name: "/root/folder1/file2.ts" }
                const file3: File = { name: "/root/generated/folder1/file3.ts" }
                const file4: File = { name: "/root/generated/folder2/file4.ts" }
                const file5: File = { name: "/root/someanotherfolder/file5.ts" }
                const host = createModuleResolutionHost(hasDirectoryExists, file1, file2, file3, file4, file5);
                
                for (const moduleResolution of [ModuleResolutionKind.NodeJs, ModuleResolutionKind.Classic]) {
                    const options: CompilerOptions = {
                        moduleResolution,
                        baseUrl: "/root",
                        paths: {
                            "*": [
                                "*",
                                "generated/*"
                            ],
                            "somefolder/*": [
                                "someanotherfolder/*"
                            ]
                        }
                    };
                    {
                        const result = resolveModuleName("folder1/file2", file1.name, options, host);
                        assert.isTrue(result.resolvedModule !== undefined, "module should be resolved");
                        assert.equal(result.resolvedModule.resolvedFileName, file2.name);
                        assert.deepEqual(result.failedLookupLocations, []);
                    }
                    {
                        const result = resolveModuleName("./file2", file1.name, options, host);
                        assert.isTrue(result.resolvedModule !== undefined, "module should be resolved");
                        assert.equal(result.resolvedModule.resolvedFileName, file2.name);
                        assert.deepEqual(result.failedLookupLocations, []);
                    }
                    {
                        const result = resolveModuleName("folder1/file3", file1.name, options, host);
                        assert.isTrue(result.resolvedModule !== undefined, "module should be resolved");
                        assert.equal(result.resolvedModule.resolvedFileName, file3.name);
                        // non-empty because it tries to use '*' match first 
                        assert.deepEqual(result.failedLookupLocations, [
                            "/root/folder1/file3.ts",
                            "/root/folder1/file3.tsx",
                            "/root/folder1/file3.d.ts",
                        ]);
                    }
                    {
                        const result = resolveModuleName("folder2/file4", file1.name, options, host);
                        assert.isTrue(result.resolvedModule !== undefined, "module should be resolved");
                        assert.equal(result.resolvedModule.resolvedFileName, file4.name);
                        assert.deepEqual(result.failedLookupLocations, [
                            "/root/folder2/file4.ts",
                            "/root/folder2/file4.tsx",
                            "/root/folder2/file4.d.ts",
                        ]);
                    }
                    {
                        const result = resolveModuleName("somefolder/file5", file1.name, options, host);
                        assert.isTrue(result.resolvedModule !== undefined, "module should be resolved");
                        assert.equal(result.resolvedModule.resolvedFileName, file5.name);
                        assert.deepEqual(result.failedLookupLocations, []);
                    }
                    // add failure tests
                }
            }
        });

        it("module resolution with path mappings and root dirs", () => {
            test(/*hasDirectoryExists*/ false);
            test(/*hasDirectoryExists*/ true);

            function test(hasDirectoryExists: boolean) {
                let file1: File = { name: "/root/folder1/file1.ts" };
                let file2: File = { name: "/root/generated/folder1/file2.ts" };
                let file3: File = { name: "/root/generated/folder2/file3.ts" };
                const host = createModuleResolutionHost(hasDirectoryExists, file1, file2, file3);
                const options: CompilerOptions = {
                    moduleResolution: ModuleResolutionKind.BaseUrlOnly,
                    baseUrl: "/root",
                    paths: {
                        "*": [
                            "*",
                            "generated/*"
                        ]
                    },
                    rootDirs: [
                        "/root",
                        "/root/generated/"
                    ]
                };
                {
                    const result = resolveModuleName("./file2", file1.name, options, host);
                    assert.isTrue(result.resolvedModule !== undefined, "module should be resolved");
                    assert.equal(result.resolvedModule.resolvedFileName, file2.name);
                    assert.deepEqual(result.failedLookupLocations, [
                        "/root/folder1/file2.ts",
                        "/root/folder1/file2.tsx",
                        "/root/folder1/file2.d.ts",
                    ]);
                }
                {
                    const result = resolveModuleName("../folder1/file1", file3.name, options, host);
                    assert.isTrue(result.resolvedModule !== undefined, "module should be resolved");
                    assert.equal(result.resolvedModule.resolvedFileName, file1.name);
                    assert.deepEqual(result.failedLookupLocations, []);
                }
            }
        });
    });

    function notImplemented(name: string): () => any {
        return () => assert(`${name} is not implemented and should not be called`);
    }

    describe("ModuleResolutionHost.directoryExists", () => {
        it("No 'fileExists' calls if containing directory is missing", () => {
            const host: ModuleResolutionHost = {
                readFile: notImplemented("readFile"),
                fileExists: notImplemented("fileExists"),
                directoryExists: _ => false
            };

            const result = resolveModuleName("someName", "/a/b/c/d", { moduleResolution: ModuleResolutionKind.NodeJs }, host);
            assert(!result.resolvedModule);
        });
    });
}