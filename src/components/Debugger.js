import { IController, Model, IView } from '../lib/mvc.js';
import JSZip from 'jszip/dist/jszip.min.js';
import DOM from '../lib/dry-dom.js';

const compiler = "https://projectabe.herokuapp.com/";

class Debugger {

    static "@inject" = {
        pool:"pool",
        model: [Model, {scope:"root"}]
    }

    constructor( DOM ){
	this.model.setItem("ram.fuzzy", []);
	this.pool.add(this);
	
	this.DOM = DOM;
	this.history = [];
	this.da = [];
	this.RAM = [];
	this.state = [];
	this.hints = {};
	this.comments = {};
	this.srcmap = [];
	this.rsrcmap = {};
	this.currentPC = null;
	this.ramComments = {};

	this.code = null;
	this.compileId = 0;

	// this.initSource();
	
    }

    setActiveView(){
	this.pool.remove(this);
    }    

    initSource(){
	if( this.source )
	    return true;
	
	this.source = this.model.getModel(
	    this.model.getItem("app.srcpath"),
	    true
	) || new Model();

	let promise = null;

	let srcurl = this.model.getItem("ram.srcurl", "");

	if( /.*\.ino$/.test(srcurl) ){
	    
	    promise = fetch( this.model.getItem("app.proxy") + srcurl )
		.then( rsp => rsp.text() )
		.then( txt => {

		    if( txt.charCodeAt(0) == 0xFEFF )
			txt = txt.substr(1);
		    
		    this.addNewFile( "main.ino", txt );
		    
		});
	    
	}else if( srcurl ){

	    promise = fetch( this.model.getItem("app.proxy") + srcurl )
		.then( rsp => rsp.arrayBuffer() )
		.then( buff => JSZip.loadAsync( buff ) )
		.then( z => this.importZipSourceFiles(z) );

	}else if( !Object.keys(this.source.data).length ){
	    this.addNewFile(
		"main.ino",
`/*
Hello, World! example
June 11, 2015
Copyright (C) 2015 David Martinez
All rights reserved.
This code is the most basic barebones code for writing a program for Arduboy.

This library is free software; you can redistribute it and/or
modify it under the terms of the GNU Lesser General Public
License as published by the Free Software Foundation; either
version 2.1 of the License, or (at your option) any later version.
*/

#include <Arduboy2.h>

// make an instance of arduboy used for many functions
Arduboy2 arduboy;


// This function runs once in your game.
// use it for anything that needs to be set only once in your game.
void setup() {
  // initiate arduboy instance
  arduboy.begin();

  // here we set the framerate to 15, we do not need to run at
  // default 60 and it saves us battery life
  arduboy.setFrameRate(15);
}


// our main game loop, this runs once every cycle/frame.
// this is where our game logic goes.
void loop() {
  // pause render until it's time for the next frame
  if (!(arduboy.nextFrame()))
    return;

  // first we clear our screen to black
  arduboy.clear();

  // we set our cursor 5 pixels to the right and 10 down from the top
  // (positions start at 0, 0)
  arduboy.setCursor(4, 9);

  // then we print to screen what is in the Quotation marks ""
  arduboy.print(F("Hello, world!"));

  // then we finaly we tell the arduboy to display what we just wrote to the display
  arduboy.display();
}
`
	    );
	}

	
	if( promise )
	    promise.catch(err => {
		console.error( err.toString() );
		core.history.push( err.toString() );
		this.DOM.element.setAttribute("data-tab", "history");
		this.refreshHistory();
	    });
	
	if( !this.source )
	    return false;

	this.initEditor();

	return true;
	
	let main = null;
	for( let k in this.source ){
	    if( /.*\.ino$/.test(k) ){
		main = k;
		break;
	    }		
	}

	if( main !== null )
	    this.DOM.currentFile.value = main;

	
    }

    showDebugger(){
	this.DOM.element.setAttribute("hidden", "false");
	this.DOM.element.setAttribute("data-tab", "source");
	this.initSource();
    }

    initEditor(){
	if( this.code )
	    return;
	
	this.code = ace.edit( this.DOM.ace );
	this.code.$blockScrolling = Infinity;
	this.code.setTheme("ace/theme/monokai");
	this.code.getSession().setMode("ace/mode/c_cpp");
	this.code.resize(true);
	
	this.code.session.on( "change", _ => this.commit() );
	
	this.code.on("guttermousedown", e => {
	    let target = e.domEvent.target; 
	    if (target.className.indexOf("ace_gutter-cell") == -1) 
		return; 
	    if (!this.code.isFocused()) 
		return;
	    /*
	    if (e.clientX > 25 + target.getBoundingClientRect().left) 
		return; 
	    */

	    e.stop();
	    
	    var line = e.getDocumentPosition().row+1;
	    var file = this.DOM.currentFile.value;
	    var addr = this.rsrcmap[file+":"+line];
	    if( addr !== undefined ){
		if( core.breakpoints[addr] )
		    core.breakpoints[addr] = false;
		else
		    core.breakpoints[addr] = () => true;
		
		core.enableDebugger();
		this.changeBreakpoints();
	    }else{
		this.code.session.setBreakpoint( line-1, "invalid");
	    }
	    
	});

//	this.code.setKeyboardHandler("ace/keyboard/emacs");
		
        this.code.commands.addCommand({
            name: "replace",
            bindKey: {win: "Ctrl-Enter", mac: "Command-Option-Enter"},
            exec: () => this.compile()
        });	    

        this.code.commands.addCommand({
            name: "fuzzy",
            bindKey: {win: "Ctrl-P", mac: "Command-P"},
            exec: () => this.showFuzzyFinder()
        });	    

	this.changeSourceFile();

    }

    deleteFile(){
	if( !this.initSource() ) return;

	if( !confirm("Are you sure you want to delete " + this.DOM.currentFile.value + "?") )
	    return;
	this.source.removeItem([this.DOM.currentFile.value]);
	this.DOM.currentFile.value = Object.keys(this.source.data)[0];
	this.changeSourceFile();
    }

    renameFile(){
	if( !this.initSource() ) return;

	let current = this.DOM.currentFile.value;
	let target = prompt("Rename " + current + " to:").trim();
	if( target == "" ) return;
	let src = this.source.getItem([current]);
	this.source.removeItem([current]);
	this.source.setItem([target], src);
	this.DOM.currentFile.value = target;
    }

    addNewFile( target, content ){
	if( !this.initSource() ) return;

	if( typeof target !== "string" )
	    target = prompt("File name:").trim();
	
	if( target == "" ) return;

	if( typeof content !== "string" )
	    content = "";
	
	this.source.setItem( [target], content );
	this.DOM.currentFile.value = target;
	
	this.changeSourceFile();
	
    }

    zip(){
	
	var zip = new JSZip();
	let source = this.source.data;
	
	for( let name in source )
	    zip.file( name, source[name]);
	
	zip.generateAsync({type:"blob"})
	    .then( content => {
		
		if( !this.saver ){
		    
		    this.saver = this.DOM.create("a", {
			className:"FileSaver",
			textContent:"ZIP",
			attr:{
			    download:"ArduboyProject"
			}
		    }, document.body);
		    
		}else
		    URL.revokeObjectURL( this.saver.href );
				
		this.saver.href = URL.createObjectURL( content );
		this.saver.style.display = "block";
		
	    });	
    }

    importZipSourceFiles( z ){

	for( let k in z.files ){
	    if( /.*\.(h|hpp|c|cpp|ino)$/i.test(k) ){
		addFile.call( this, k );
	    }
	}

	function addFile( name ){
	    z.file(name)
		.async("text")
		.then( txt =>{
		    
		    if( txt.charCodeAt(0) == 0xFEFF )
			txt = txt.substr(1);

		    this.addNewFile( name.replace(/\\/g, "/"), txt );
		    
		})
		.catch( err => {
		    console.error( err.toString() );
		    this.source.setItem([name], "// ERROR LOADING: " + err)
		});
	}
	
    }

    onDropFile( dom, event ){
	event.stopPropagation();
	event.preventDefault();


	var dt = event.dataTransfer;
	var files = dt.files;

	for (var i = 0; i < files.length; i++) {
	    let file = files[i];
	    if( /.*\.(png|jpg)$/i.test(file.name) )
		loadImageFile.call( this, file );
	    if( /.*\.zip$/i.test(file.name) )
		loadZipFile.call( this, file );
	}

	this.changeSourceFile();
	
	function loadZipFile( file ){
	    let fr = new FileReader();
	    fr.onload = evt => {
		
		JSZip.loadAsync( fr.result )
		    .then( z => this.importZipSourceFiles(z) );
		
	    };
	    fr.readAsArrayBuffer( file );
	}

	function loadImageFile( file ){
	    let fr = new FileReader();
	    fr.onload = evt => {

		let cleanName = file.name.replace(/^.*?([^\/\\.]+)\..+$/,'$1');
		
		let img = DOM.create("img", {
		    src:fr.result,
		    onload:_=>{

			let width = img.naturalWidth;

			let canvas = DOM.create("canvas", {
			    width,
			    height: img.naturalHeight
			});

			let ctx = canvas.getContext("2d");
			ctx.drawImage( img, 0, 0 );

			let data = ctx.getImageData( 0, 0, canvas.width, canvas.height );

			let masksrc = "\nconst unsigned char PROGMEM " + cleanName + "_mask[] = ";

			let src = "";
			src += "\n\nconst unsigned char PROGMEM " + cleanName + "[] = ";
			
		        src += "{\n// width, height,\n" + width + ", " + img.naturalHeight;
			masksrc += "{";
		        
		        let pageCount = Math.ceil( img.naturalHeight / 8 );
		        let currentByte = 0, isPNG = /.*\.png$/i.test(file.name);
		        
		        // Read the sprite page-by-page
		        for( let page = 0; page < pageCount; page++ ) {

		            // Read the page column-by-column
		            for( let column = 0; column < width; column++ ) {

		        	// Read the column into a byte
		        	let spriteByte = 0, maskByte = 0;
		        	for( let yPixel = 0; yPixel < 8; yPixel++) {

				    let i = ((page*8 + yPixel) * data.width + column) * 4;
				    let lum = (data.data[i  ] + data.data[i+1] + data.data[i+2]) / 3;

		        	    if( lum > 128 )
		        	        spriteByte |= (1 << yPixel);
		        	    if( data.data[ i+3 ] > 128 )
					maskByte |= (1 << yPixel);
		        	}

				src += ",";

				if( currentByte != 0 )
				    masksrc += ",";
				
		        	if( currentByte%width == 0 ){
		        	    src += "\n"; masksrc += "\n";
				}

		        	src += "0x" + spriteByte.toString(16).padStart(2, "0");
		        	if( isPNG )
				    masksrc += "0x" + maskByte.toString(16).padStart(2, "0");

		        	currentByte++;
		            }
		        }
		        src += "\n};\n\n"; masksrc += "\n};\n\n";

			if( isPNG )
			    src += masksrc;
			
			src += "\n";

			var bmpcpp = this.source.getItem(["bmp.cpp"], "#include <Arduino.h>\n#include \"bmp.h\"\n");
			var hasHeader = false;
			var headerPath = "bmp/" + cleanName + ".h";
			
			bmpcpp.replace(/(?:^|\n)\s*#include\s+"([^"]+)"/g, (_, inc) =>{
			    hasHeader = hasHeader || inc == headerPath;
			    return "";
			});
			
			if( !hasHeader )
			    bmpcpp += "\n#include \"" + headerPath + "\"\n";

			this.source.setItem(["bmp.cpp"], bmpcpp);

			var bmph = this.source.getItem(["bmp.h"], "");
			var hasExtern = false;

			bmph.replace(/(?:^|\n)\s*extern\s+const\s+unsigned\s+char\s+PROGMEM\s+([^\[\s\[]+)/g, (_, inc) => {
			    hasExtern = hasExtern || inc == cleanName;
			});

			if( !hasExtern ){
			    bmph = "extern const unsigned char PROGMEM " +
				cleanName + "[], " +
				cleanName + "_mask[];\n" +
				bmph;
			}

			this.source.setItem(["bmp.h"], bmph);
			
			this.addNewFile( headerPath, src );
			
		    }
		    
		});
		
		    
	    };
	    fr.readAsDataURL(file);
	}
	
    }    

    changeBreakpoints(){

	this.code.session.clearBreakpoints();
	if( typeof core == "undefined" ) return;

	let paused = null;
	for( let addr in core.breakpoints ){
	    
	    if( addr in this.srcmap && core.breakpoints[addr] ){
		
		let c = "unconditional";
		if( addr == this.currentPC ){
		    c += " paused";
		    paused = true;
		}
		this.code.session.setBreakpoint( this.srcmap[addr].line-1, c );
	    }
	    	    
	}
	
	if( !paused && this.srcmap[ this.currentPC ] ){
	    this.code.session.setBreakpoint( this.srcmap[this.currentPC].line-1, "paused" );
	}
	
    }

    showFuzzyFinder(){
	this.DOM.currentFile.style.display = "none";
	this.DOM.fuzzyContainer.style.display = "block";
	this.DOM.fuzzy.focus();
	this.DOM.fuzzy.setSelectionRange(0, this.DOM.fuzzy.value.length);
    }

    updateFuzzyFind( dom, evt ){

	let matches;
	let str = this.DOM.fuzzy.value.trim().replace();
	
	if( str.length > 1 ) matches = fuzzy( str, Object.keys(this.source.data) );
	else matches = [];
	
	this.model.setItem( "ram.fuzzy", matches.sort( (a,b)=>a.rank-b.rank ).map( a=>a.match ) );


	function fuzzy( str, args ){

	    if ( str === void 0 ) str = '';
	    if ( args === void 0 ) args = [];

	    var escaped = str.replace(/[|\\{}()\[\]^$+*?.]/g, '\\$&');
	    var regex = new RegExp(((escaped.split(/(\\.|)/).filter( x=>x.length ).join('(.*)')) + ".*"));
	    var length = str.length;

	    return args.reduce(function (acc, possibleMatch) {
		var result = regex.exec(possibleMatch);

		if (result) {
		    acc.push({
			match: possibleMatch,
			rank: result.index
		    });
		}
		return acc
	    }, []);
	    
	}
    }

    cancelFuzzyFind( dom, evt ){
	
	if( evt ) return setTimeout( _=>this.cancelFuzzyFind(), 10 );
	
	this.DOM.fuzzyContainer.style.display = "none";
	this.DOM.currentFile.style.display = "";
	this.code.focus();
	
    }

    endFuzzyFind( dom, evt ){
	
	let results = this.model.getItem("ram.fuzzy", []);
	let result = null;
	
	if( evt ){
	    if( evt.type == "keydown" ){
		
		if( evt.key == "Escape")
		    return this.cancelFuzzyFind();
		else if( evt.key != "Enter" )
		    return;

		evt.preventDefault();
		evt.stopPropagation();
		
	    }else if( evt.target.textContent in this.source.data )		
		result = evt.target.textContent;
	    
	}
    
	if( !result && results.length )
	    result = results[0];
	
	if( result ){
	    this.DOM.currentFile.value = result;
	    setTimeout( _=>this.changeSourceFile(), 10 );
	}
	
	this.cancelFuzzyFind();
	
    }

    changeSourceFile(){
	if( !this.code ) return;
	this.code.setValue( this.source.getItem([ this.DOM.currentFile.value ],"") );
	this.changeBreakpoints();
    }

    initHints( txt ){
	let source = this.source.data;
	this.srcmap = [];
	this.rsrcmap = {};
	txt.replace(
		/\n([\/a-zA-Z0-9._\- ]+):([0-9]+)\n([\s\S]+?)(?=$|\n[0-9a-f]+ <[^>]+>:|\n(?:[\/a-zA-Z0-9._\-<> ]+:[0-9]+\n))/g,
	    (m, file, line, code)=>{
		 
		file = file.replace(/^\/app\/builds\/[0-9]+\//, '');
		
		file = file.replace(/^\/app\/public\/builds\/[0-9]+\/sketch\/(.*)/, (match,name) => {
		    for( let candidate in source ){
			candidate = '/' + candidate;
			if( candidate.substr(candidate.length-name.length-1) == "/" + name ){
			    return candidate.substr(1);
			}			  
		    }
		    
		});
		
		if( !(file in source) )
		    return '';
		
		code = '\n' + code;
		let pos = 0;
		code.replace(
			/(?:[\s\S]*?\n)\s+([0-9a-f]+):\t[ a-f0-9]+\t(?:[^\n\r]+)/g,
		    (m, addr) => {
			
			addr = parseInt(addr, 16)>>1;
			
			if( !pos )
			    this.rsrcmap[ file+":"+line ] = addr;
			
			this.srcmap[ addr ] = {file, line, offset:pos++};

			return '';
		    }
		);
		
		return '';
	    });
	
	this.hints = {};
	txt = txt.replace(/\n([0-9a-f]+)\s+(<[^>]+>:)(?:\n\s+[0-9a-f]+:[^\n]+|\n+\s+\.\.\.[^\n]*)+/g, (txt, addr, lbl) =>{
	    this.hints[ parseInt(addr, 16)>>1 ] = (lbl).trim();
	    return '';
	});
	
	txt.replace(/([\s\S]*?\n)\s+([0-9a-f]+):\t[ a-f0-9]+\t([^\n\r]+)/g, (txt, before, addr, after) => {
	    this.hints[ parseInt(addr, 16)>>1 ] = (before + after).trim();
	    return '';
	    
	});
	
    }

    commit(){
	this.source.setItem( [this.DOM.currentFile.value], this.code.getValue() );
    }

    initQRCGen(){
	if( typeof QRCode == "undefined" ){
	    self.QRCode = false;
	    DOM.create("script", {src:"qrcode.min.js"}, document.head);
	}
    }
    
    updateQRCode( url ){

	this.initQRCGen();

	if( !self.QRCode )
	    return;
	
	url = url.replace(/^https?:/i, "arduboy:");
	
	if( !this.qrcode ){
	    
	    this.qrcode = new QRCode( this.DOM.qrcContainer, {
		text:url,
		correctLevel: QRCode.CorrectLevel.L
	    });
	    
	}else{
	    
	    this.qrcode.clear();
	    this.qrcode.makeCode( url );
	    
	}
	    
	this.DOM.qrc.style.display = "inline";

	if( this.qrcClearTH )
	    clearTimeout( this.qrcClearTH );

	this.qrcClearTH = setTimeout( _=>{
	    
	    this.qrcode.clear();
	    this.DOM.qrc.style.display = "none";
	    if( this.DOM.element.getAttribute("data-tab") == "qr" )
 		this.DOM.element.setAttribute("data-tab", "source");

	    
	}, 50000 );
	
    }

    compile(){
	if( this.DOM.compile.style.display == "none" )
	    return;
	
	this.DOM.compile.style.display = "none";

	this.commit();

	let src = {};
	for( let key in this.source.data ){
	    if( /.*\.(?:hpp|h|c|cpp|ino)$/i.test(key) )
		src[key] = this.source.data[key];
	}

	let mainFile = null;
	Object.keys(src).forEach( k => {
	    if( /.*\.ino$/.test(k) ){
		
		if( !mainFile || k == this.DOM.currentFile.value ){
		    
		    if( mainFile )
			delete src[mainFile];
		    
		    mainFile = k;
		    
		}else delete src[k];
		
	    }
	});

	this.initQRCGen();

	fetch( compiler + "build", {
	    method:"POST",
	    body:JSON.stringify( src )
	})
	    .then( rsp => rsp.text() )
	    .then( txt => {

		this.compileId = parseInt(txt);
		this.pollCompilerService();
		
	    })
	    .catch( err => {
		
		core.history.push( err.toString() );
		this.DOM.element.setAttribute("data-tab", "history");
		this.refreshHistory();
		this.DOM.compile.style.display = "initial";
		
	    });
    }

    pollCompilerService(){
	
	fetch( compiler + "poll?id=" + this.compileId )
	    .then( rsp => rsp.text() )
	    .then( txt => {
		
		if( txt == "DESTROYED" ){
		    
		    this.compileId = null;
		    this.compile();
		    return;
		    
		}else if( txt[0] == "{" ){
		    
		    let data = JSON.parse( txt );
		    this.model.removeItem("app.AT32u4");

		    this.updateQRCode( compiler + data.path );
		    
		    fetch( compiler + data.path )
			.then( rsp => rsp.text() )
			.then( text => {
			    
			    this.model.setItem("app.AT32u4.hex", text);
			    this.source.setItem(["build.hex"], text);
			    this.pool.call("loadFlash");
			});

		    this.initHints( data.disassembly );
		    this.DOM.compile.style.display = "initial";
		    
		    this.source.setItem(["disassembly.s"], data.disassembly);
		    
		}else if( /^ERROR[\s\S]*/.test(txt) ){

		    txt.split("\n").forEach( p => core.history.push(p) );

		    this.DOM.element.setAttribute("data-tab", "history");
		    this.refreshHistory();
		    this.DOM.compile.style.display = "initial";
		    
		}else
		    setTimeout( _ => this.pollCompilerService(), 3000 );
		
	    })
	    .catch( err => {
		
		core.history.push( err.toString() );
		this.DOM.element.setAttribute("data-tab", "history");
		this.refreshHistory();
		this.DOM.compile.style.display = "initial";
		
	    });
    }
    
    refreshRAM( ignoreAuto ){

	if( !ignoreAuto && this.DOM.autoRefreshRAM.checked )
	    setTimeout( _ => this.refreshRAM(), 1000 );
	
	let src = core.memory;
	
	while( this.RAM.length > src.length )
	    this.DOM.RAM.removeChild( this.RAM.pop() );
	
	while( this.RAM.length < src.length )
	    this.RAM.push( this.DOM.create( "li", this.DOM.RAM, {
		title:"0x" + this.RAM.length.toString(16).padStart(4,"0")
	    }) );

	this.RAM.forEach( (li, idx) => {
	    li.textContent = src[idx].toString(16).padStart(2, "0");
	});
	
    }

    openRAMTT( _, evt ){
	let tt = this.DOM.RAMTT;
	
	let addr = parseInt( evt.target.title, 16 ) || 0;

	this.ttAddr = addr;

	Object.assign(tt.style, {
	    top: evt.target.offsetTop + "px",
	    left: evt.target.offsetLeft + "px",
	    display: "block"
	});

	this.DOM.RAMTTvalue.value = core.memory[ addr ].toString(16).padStart(2, "0");
	this.DOM.RAMTTread.checked = !!core.readBreakpoints[ addr ];
	this.DOM.RAMTTwrite.checked = !!core.writeBreakpoints[ addr ];
	this.DOM.comment.value = this.ramComments[ addr ] || "";
	this.DOM.RAMTTaddr.textContent = "0x" + addr.toString(16).padStart(4, "0");
	
    }

    toggleRAMReadBP(){
	let addr = this.ttAddr || 0;
	core.readBreakpoints[ addr ] = !core.readBreakpoints[ addr ];
	this.updateRAMColor();
    }

    toggleRAMWriteBP(){
	let addr = this.ttAddr || 0;
	core.writeBreakpoints[ addr ] = !core.writeBreakpoints[ addr ];
	this.updateRAMColor();
    }

    updateRAMColor(){
	let color = [0,0,0];
	if( core.readBreakpoints[ this.ttAddr ] ) color[0] = 255;
	if( core.writeBreakpoints[ this.ttAddr ] ) color[1] = 255;
	if( this.ramComments[ this.ttAddr ] ) color[2] = 255;
	color = color.join(",");
	if( color == "0,0,0" ) color = '';
	else color = "rgba(" + color + ",0.5)";
	this.RAM[ this.ttAddr ].style.backgroundColor = color;
    }

    closeRAMTT(){
	this.DOM.RAMTT.style.display = "none";
    }

    setTTvalue(){
	core.memory[ this.ttAddr ] = parseInt( this.DOM.RAMTTvalue.value.trim().replace(/^#|^0x/, ''), 16 ) || 0;
	this.RAM[ this.ttAddr ].textContent = core.memory[ this.ttAddr ];
    }

    setTTComment(){
	this.ramComments[ this.ttAddr ] = this.DOM.comment.value.trim();
	this.RAM[ this.ttAddr || 0 ].title = "0x" + this.ttAddr.toString(16).padStart(4, "0") + " " + this.ramComments[ this.ttAddr ];
	this.updateRAMColor();
    }

    refreshState( ignoreAuto ){

	if( !ignoreAuto && this.DOM.autoRefreshState.checked )
	    setTimeout( _ => this.refreshState(), 1000 );
	
	let src = core.state().replace(/\t/g, "    ").replace(/ /g, "&nbsp;").split("\n");
	
	while( this.state.length > src.length )
	    this.DOM.state.removeChild( this.state.shift() );
	
	while( this.state.length < src.length )
	    this.state.push( this.DOM.create( "li", this.DOM.state, [["code"]]) );

	this.state.forEach( (li, idx) => {
	    li.children[0].innerHTML = src[idx];
	});
	
    }

    refreshDa(){
	this.refreshState( true );
	let pc = this.currentPC;
	
	let addr = parseInt( this.DOM.daAddress.value.replace(/^.*[x#]/, ""), 16 ) | 0;
	this.DOM.daAddress.value = addr.toString(16).padStart( 4, "0" );
	
	let src = core.da( addr, 50 )/*.replace(/\t/g, "    ").replace(/ /g, "&nbsp;")*/.split("\n");
	
	while( this.da.length > src.length )
	    this.DOM.da.removeChild( this.da.shift() );
	
	while( this.da.length < src.length ){
	    let el = this.DOM.create( "li", this.DOM.da, [
		["pre",{className:"opContainer"},[
		    ["div", {className:"breakpoint"}],
		    ["code", {className:"op"}]]
		],
		["pre",{className:"commentContainer"},[["code", {className:"comment"}]]]
	    ], {
		onclick:evt=>this.onClickDAItem(evt.currentTarget)
	    });
	    el.dom = (new DOM(el)).index(["id", "className"]);
	    this.da.push( el );
	}

	this.da.forEach( (li, idx) => {
	    
	    let addr = parseInt( src[idx].replace(/&nbsp;/g, ''), 16 ) >> 1;
	    
	    li.address = addr;
	    
	    if( core.breakpoints[addr] )
		li.setAttribute('breakpoint', 'true');
	    else
		li.setAttribute('breakpoint', 'false');

	    if( addr === pc )
		li.setAttribute('pc', 'true');
	    else
		li.setAttribute('pc', 'false');
	    

	    let srcparts = src[idx].split(';');
	    li.dom.op.textContent = srcparts.shift();	    

	    let hint = this.hints[ addr ];
	    if( hint ){
		li.dom.comment.textContent = hint;
	    }else{
		li.dom.comment.textContent = srcparts.join(';');
	    }
	    
	});
	    
    }

    onHitBreakpoint( pc ){
	this.currentPC = pc;
	let srcref = this.srcmap[pc];
	
	if(
	    srcref &&
		srcref.offset &&
		!(pc in core.breakpoints || pc in core.readBreakpoints || pc in core.writeBreakpoints) &&
		this.DOM.element.getAttribute("data-tab") == "source"
	){
	    this.reqStep();
	    return;
	}
	
	this.DOM.daAddress.value = (Math.max(pc-5,0)<<1).toString(16);
	this.refreshDa();
	if( srcref && !srcref.offset && this.source.getItem([srcref.file]) ){
	    this.DOM.element.setAttribute("data-tab", "source");
	    this.DOM.currentFile.value = srcref.file;
	    this.changeSourceFile();
	    this.code.scrollToLine( srcref.line, true, true, _=>{} );
	    this.code.gotoLine( srcref.line, 0, true );
	}else{
	    this.DOM.element.setAttribute("data-tab", "da");
	}
	this.DOM.element.setAttribute("paused", "true");
    }

    onScrollDA( DOM, evt ){
	let off = (evt.deltaY > 0 ? -2 : 2) * 4;
	this.DOM.daAddress.value = Math.max( 0, parseInt( this.DOM.daAddress.value, 16 ) - off ).toString(16);
	this.refreshDa();
    }

    onClickDAItem( item ){
	let addr = item.address || 0;
	if( item.getAttribute("breakpoint") !== "true" ){
	    item.setAttribute("breakpoint", "true");
	    
	    core.breakpoints[ addr ] = (pc,sp) => true;
	    
	    core.enableDebugger();
	    
	} else {

	    item.setAttribute("breakpoint", "false");
	    core.breakpoints[ addr ] = null;
	    
	}
	
    }

    reqReset(){
	this.pool.call("reset");
    }

    reqResume(){
	this.DOM.element.setAttribute("paused", "false");
	this.pool.call("resume");
    }

    reqStep(){
	this.pool.call("step");
    }

    refreshHistory(){
	
	if( this.DOM.autoRefreshHistory.checked )
	    setTimeout( _ => this.refreshHistory(), 1000 );
	
	while( core.history.length > this.history.length )
	    this.history.push(
		this.DOM.create(
		    "li",
		    this.DOM.history,
		    {
			onclick: evt => {
			    let m = evt.target.dataset.text.match( /^#([0-9a-f]{4,})\s?.*$/ );
			    if( m ){
				this.DOM.element.setAttribute("data-tab", "da");
				this.DOM.daAddress.value = m[1];
				this.refreshDa();
			    }
			}
		    }
		)
	    );
	
	while( this.history.length > core.history.length )
	    this.DOM.history.removeChild( this.history.shift() );
	
	this.history.forEach( (li, idx) => {
	    if( li.dataset.text != core.history[idx] )
		li.setAttribute("data-text", core.history[idx]);	    
	});

	this.DOM.history.scrollTop = this.DOM.history.scrollHeight - this.DOM.history.clientHeight;
	
    }
    
};

export default Debugger;
