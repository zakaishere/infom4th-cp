import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws IOException {
        String s = new BufferedReader(new InputStreamReader(System.in)).readLine().trim();
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < s.length(); ) {
            int j = i;
            while (j < s.length() && s.charAt(j) == s.charAt(i)) ++j;
            out.append(s.charAt(i)).append(j - i);
            i = j;
        }
        System.out.println(out);
    }
}
