package com.cpplatform.laboratory;

import com.cpplatform.common.Api;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import java.util.*;

/**
 * Signature of a function problem: the contestant writes one function and the judge generates the
 * driver around it (judge/drivers.py). Types are a base (int, long, double, bool, string) followed by
 * up to two "[]". Test inputs hold one JSON value per parameter line; expected outputs one JSON value.
 */
public final class FunctionSignature {
    private FunctionSignature() {}
    private static final ObjectMapper JSON=new ObjectMapper();
    public static final List<String> BASES=List.of("int","long","double","bool","string");
    /** Every language but Brainfuck, which has no functions. */
    public static final Set<String> LANGUAGES=Set.of("CPP","CPP20","C","JAVA","PYTHON","PYPY","JAVASCRIPT","GO","RUST","KOTLIN","CSHARP","RUBY","PHP","ZIG");
    /** Keywords and names the generated code uses, in any supported language (C adds returnSize, Zig an allocator). */
    private static final Set<String> RESERVED=Set.of("allocator","returnsize","returncolumnsizes",
            "abstract","alignas","and","array","as","asm","assert","async","auto","await","begin","bool","boolean",
            "break","byte","case","catch","char","class","const","continue","crate","def","default","defer","del","delete","do","double","dyn","echo","elif",
            "else","elsif","end","ensure","enum","error","errdefer","exit","export","extends","extern","false","final","finally","float","fn","for","foreach",
            "friend","from","fun","func","function","global","go","goto","if","impl","implements","import","in","include","inline","instanceof","int","interface",
            "is","lambda","let","long","loop","main","match","mod","module","move","mut","namespace","native","new","next","nil","none","not","null",
            "object","operator","or","orelse","out","override","package","pass","private","protected","pub","public","raise","redo","ref","register",
            "rescue","retry","return","self","short","signed","sizeof","static","std","string","struct","super","switch","template","then","this",
            "throw","throws","trait","true","try","type","typedef","typename","typeof","union","unless","unsigned","unsafe","until","use","using","val","var",
            "vector","virtual","void","volatile","when","where","while","with","yield");

    record Type(String base,int dims) {}

    static Type type(Object raw) {
        Api.require(raw instanceof String,HttpStatus.BAD_REQUEST,"Every parameter and the return value need a type");
        String text=(String)raw,base=text;int dims=0;
        while(dims<2 && base.endsWith("[]")){base=base.substring(0,base.length()-2);dims++;}
        Api.require(BASES.contains(base),HttpStatus.BAD_REQUEST,"Unsupported type: "+text+" (use int, long, double, bool or string, with up to two [])");
        return new Type(base,dims);
    }

    /** twoSum -> two_sum, as Rust and Ruby name it (same rule as the judge and the frontend). */
    static String snake(String name) { return name.replaceAll("([a-z0-9])([A-Z])","$1_$2").toLowerCase(Locale.ROOT); }

    private static void name(Object raw,String what,Set<String> seen) {
        Api.require(raw instanceof String && ((String)raw).matches("[a-z][a-zA-Z0-9]{0,39}"),HttpStatus.BAD_REQUEST,
                what+" must start with a lowercase letter and use only letters and digits (at most 40)");
        String name=(String)raw;
        // Zig reserves its primitive type names (i32, u8, f64, usize...).
        Api.require(!RESERVED.contains(name.toLowerCase(Locale.ROOT)) && !RESERVED.contains(snake(name))
                && !name.matches("[iu][0-9]+|f(16|32|64|80|128)|[iu]size"),HttpStatus.BAD_REQUEST,
                "\""+name+"\" is a reserved word in one of the languages; choose another name");
        Api.require(seen.add(snake(name)),HttpStatus.BAD_REQUEST,"Names must be different: "+name);
    }

    /** The validated signature as JSON text, or null for a standard input/output problem. */
    public static String normalize(Object raw) {
        if(raw==null)return null;
        Api.require(raw instanceof Map<?,?>,HttpStatus.BAD_REQUEST,"Invalid function signature");
        var body=(Map<?,?>)raw;
        var seen=new HashSet<String>();
        name(body.get("functionName"),"The function name",seen);
        Api.require(body.get("params") instanceof List<?> list && !list.isEmpty() && list.size()<=10,HttpStatus.BAD_REQUEST,"A function takes 1-10 parameters");
        var params=new ArrayList<Map<String,Object>>();
        for(Object item:(List<?>)body.get("params")) {
            Api.require(item instanceof Map<?,?>,HttpStatus.BAD_REQUEST,"Invalid parameter");
            var param=(Map<?,?>)item;
            name(param.get("name"),"A parameter name",seen);
            type(param.get("type"));
            params.add(Map.of("name",param.get("name"),"type",param.get("type")));
        }
        type(body.get("returnType"));
        // C passes each array's length as <name>Size (and <name>ColSize for 2D arrays).
        var names=params.stream().map(p->(String)p.get("name")).toList();
        for(String a:names) for(String b:names)
            Api.require(!b.equals(a+"Size") && !b.equals(a+"ColSize"),HttpStatus.BAD_REQUEST,"\""+b+"\" clashes with the length C adds for "+a+"; choose another name");
        var clean=new LinkedHashMap<String,Object>();
        clean.put("functionName",body.get("functionName"));clean.put("params",params);clean.put("returnType",body.get("returnType"));
        try { return JSON.writeValueAsString(clean); } catch(Exception e) { throw new IllegalStateException(e); }
    }

    /** Rejects a test whose input or expected output does not fit the signature, naming the test. */
    public static void checkTest(String signature,int position,String input,String expected) {
        JsonNode root;
        try { root=JSON.readTree(signature); } catch(Exception e) { throw new IllegalStateException(e); }
        var lines=input.lines().filter(line->!line.isBlank()).toList();
        var params=root.get("params");
        String test="Test "+(position+1)+": ";
        Api.require(lines.size()==params.size(),HttpStatus.BAD_REQUEST,
                test+"the input needs exactly one line per parameter ("+params.size()+"), each a JSON value such as [1,2,3]");
        for(int i=0;i<params.size();i++) {
            String name=params.get(i).get("name").asText();
            value(lines.get(i),type(params.get(i).get("type").asText()),test+"parameter "+name);
        }
        value(expected,type(root.get("returnType").asText()),test+"the expected output");
    }

    private static void value(String text,Type type,String what) {
        JsonNode node;
        try { node=JSON.readTree(text); } catch(Exception e) { node=null; }
        Api.require(node!=null && !node.isMissingNode() && fits(node,type.base(),type.dims()),HttpStatus.BAD_REQUEST,
                what+" is not a valid "+type.base()+"[]".repeat(type.dims())+" in JSON");
    }

    private static boolean fits(JsonNode node,String base,int dims) {
        if(dims>0) {
            if(!node.isArray())return false;
            for(JsonNode item:node) if(!fits(item,base,dims-1)) return false;
            return true;
        }
        return switch(base) {
            case "int" -> node.isIntegralNumber() && node.canConvertToInt();
            case "long" -> node.isIntegralNumber() && node.canConvertToLong();
            case "double" -> node.isNumber();
            case "bool" -> node.isBoolean();
            default -> node.isTextual();
        };
    }
}
