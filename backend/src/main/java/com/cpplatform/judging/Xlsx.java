package com.cpplatform.judging;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.zip.*;

/**
 * Writes a plain Excel workbook: bold frozen header row, numbers as numbers, everything else as literal
 * text. Text cells are inline strings, so a value starting with = can never run as a formula.
 */
public final class Xlsx {
    public record Sheet(String name,List<String> header,List<List<Object>> rows) {}
    private Xlsx() {}

    public static byte[] write(List<Sheet> sheets) {
        try {
            var bytes=new ByteArrayOutputStream();
            try(var zip=new ZipOutputStream(bytes,StandardCharsets.UTF_8)) {
                var types=new StringBuilder("<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/>"
                        +"<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>");
                var list=new StringBuilder();
                var links=new StringBuilder("<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">");
                for(int i=1;i<=sheets.size();i++) {
                    types.append("<Override PartName=\"/xl/worksheets/sheet").append(i).append(".xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>");
                    list.append("<sheet name=\"").append(escape(sheets.get(i-1).name())).append("\" sheetId=\"").append(i).append("\" r:id=\"rId").append(i).append("\"/>");
                    links.append("<Relationship Id=\"rId").append(i).append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet").append(i).append(".xml\"/>");
                }
                links.append("<Relationship Id=\"rIdStyles\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>");
                entry(zip,"[Content_Types].xml",types+"</Types>");
                entry(zip,"_rels/.rels","<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>");
                entry(zip,"xl/workbook.xml","<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets>"+list+"</sheets></workbook>");
                entry(zip,"xl/_rels/workbook.xml.rels",links.toString());
                entry(zip,"xl/styles.xml","<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><fonts count=\"2\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font><font><b/><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts>"
                        +"<fills count=\"2\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill></fills><borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>"
                        +"<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs><cellXfs count=\"2\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/><xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/></cellXfs></styleSheet>");
                for(int i=1;i<=sheets.size();i++)entry(zip,"xl/worksheets/sheet"+i+".xml",sheet(sheets.get(i-1)));
            }
            return bytes.toByteArray();
        } catch(IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static void entry(ZipOutputStream zip,String name,String xml) throws IOException {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"+xml).getBytes(StandardCharsets.UTF_8));
        zip.closeEntry();
    }

    private static String sheet(Sheet sheet) {
        var out=new StringBuilder("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetViews><sheetView workbookViewId=\"0\"><pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/></sheetView></sheetViews><cols>");
        for(int c=1;c<=sheet.header().size();c++) {
            int width=sheet.header().get(c-1).length();
            // Sized from the first rows: enough to read every column without measuring the whole file.
            for(var row:sheet.rows().subList(0,Math.min(200,sheet.rows().size())))if(c<=row.size() && row.get(c-1)!=null)width=Math.max(width,String.valueOf(row.get(c-1)).length());
            out.append("<col min=\"").append(c).append("\" max=\"").append(c).append("\" width=\"").append(Math.min(60,Math.max(10,width+3))).append("\" customWidth=\"1\"/>");
        }
        out.append("</cols><sheetData>");
        row(out,1,new ArrayList<>(sheet.header()),1);
        int number=2;
        for(var row:sheet.rows())row(out,number++,row,0);
        return out.append("</sheetData></worksheet>").toString();
    }

    private static void row(StringBuilder out,int number,List<Object> values,int style) {
        out.append("<row r=\"").append(number).append("\">");
        for(int c=0;c<values.size();c++) {
            Object value=values.get(c);
            if(value==null)continue;
            String ref=column(c)+number;
            if(value instanceof Number n && Double.isFinite(n.doubleValue()))out.append("<c r=\"").append(ref).append("\" s=\"").append(style).append("\"><v>").append(n).append("</v></c>");
            else out.append("<c r=\"").append(ref).append("\" s=\"").append(style).append("\" t=\"inlineStr\"><is><t xml:space=\"preserve\">").append(escape(String.valueOf(value))).append("</t></is></c>");
        }
        out.append("</row>");
    }

    static String column(int index) {
        var name=new StringBuilder();
        for(int i=index+1;i>0;i=(i-1)/26)name.insert(0,(char)('A'+(i-1)%26));
        return name.toString();
    }

    /** Characters XML 1.0 cannot hold are dropped rather than producing a file Excel refuses to open. */
    private static String escape(String value) {
        var out=new StringBuilder(value.length());
        value.codePoints().forEach(c->{
            if(c=='&')out.append("&amp;");
            else if(c=='<')out.append("&lt;");
            else if(c=='>')out.append("&gt;");
            else if(c=='"')out.append("&quot;");
            else if(c==9 || c==10 || c==13 || (c>=0x20 && c<=0xD7FF) || (c>=0xE000 && c<=0xFFFD) || c>=0x10000)out.appendCodePoint(c);
        });
        return out.toString();
    }
}
