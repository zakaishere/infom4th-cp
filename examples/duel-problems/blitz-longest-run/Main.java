import java.io.*;
import java.util.*;

public class Main {
    static String[] tokens() throws IOException { return new String(System.in.readAllBytes()).trim().split("\\s+"); }
    public static void main(String[] args) throws IOException {
        String[] t = tokens();
        int n = Integer.parseInt(t[0]), best = 1, current = 1;
        for (int i = 2; i <= n; ++i) {
            current = t[i].equals(t[i - 1]) ? current + 1 : 1;
            best = Math.max(best, current);
        }
        System.out.println(best);
    }
}
