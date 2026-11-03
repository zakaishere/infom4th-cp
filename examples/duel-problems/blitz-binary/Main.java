import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws IOException {
        long n = Long.parseLong(new BufferedReader(new InputStreamReader(System.in)).readLine().trim());
        System.out.println(Long.toBinaryString(n));
    }
}
